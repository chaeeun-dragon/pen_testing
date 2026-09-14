#!/usr/bin/env bash
set -euo pipefail

# 북웨이브 -> Mock PG -> Haeon 카드 전체 계약 확인기
# 실제 카드정보·금융망은 사용하지 않으며, 합성 토큰만 사용한다.

BOOKWAVE_URL="${BOOKWAVE_URL:-http://localhost:8080}"
MOCK_PG_URL="${MOCK_PG_URL:-http://localhost:8083}"
HAEON_CARD_URL="${HAEON_CARD_URL:-}"
RUN_ID="${RUN_ID:-PAYMENT-FLOW-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT_DIR="${EVIDENCE_DIR:-evidence/runs}/${RUN_ID}"
CORRELATION_ID="${CORRELATION_ID:-${RUN_ID}-CORR}"
MERCHANT_REQUEST_ID="${MERCHANT_REQUEST_ID:-${RUN_ID}-REQ}"
ORDER_NO="${ORDER_NO:-${RUN_ID}-ORDER}"
AMOUNT="${AMOUNT:-1000}"

mkdir -p "$OUT_DIR"

wait_for_up() {
  local name="$1"
  local url="$2"
  local attempt
  for attempt in $(seq 1 30); do
    if curl --silent --show-error --fail --max-time 3 "$url" > "${OUT_DIR}/${name}-health.json" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "${name} health가 30초 안에 UP이 되지 않았습니다: ${url}" >&2
  return 1
}

wait_for_up bookwave "${BOOKWAVE_URL}/actuator/health"
wait_for_up mock-pg "${MOCK_PG_URL}/actuator/health"
if test -n "$HAEON_CARD_URL"; then
  wait_for_up haeon-card "${HAEON_CARD_URL}/actuator/health"
fi

body="$(cat <<JSON
{
  "correlationId": "${CORRELATION_ID}",
  "orderNo": "${ORDER_NO}",
  "merchantRequestId": "${MERCHANT_REQUEST_ID}",
  "amount": ${AMOUNT},
  "currency": "KRW",
  "paymentMethodToken": "card-token-lab-001"
}
JSON
)"
printf '%s\n' "$body" > "${OUT_DIR}/request.json"

post_payment() {
  local output="$1"
  curl --silent --show-error --max-time 20 \
    -H 'Content-Type: application/json' \
    -H "X-Correlation-Id: ${CORRELATION_ID}" \
    -H "Idempotency-Key: ${MERCHANT_REQUEST_ID}" \
    -d "$body" \
    -o "$output" \
    -w '%{http_code}' \
    "${BOOKWAVE_URL}/api/v1/payments"
}

first_status="$(post_payment "${OUT_DIR}/first-response.json")"
test "$first_status" = "200" \
  || { echo "첫 결제 요청 HTTP=${first_status}" >&2; cat "${OUT_DIR}/first-response.json" >&2; exit 1; }

grep -Eq '"decision":"(APPROVED|DECLINED)"' "${OUT_DIR}/first-response.json" \
  || { echo "첫 결제 응답에 decision이 없습니다." >&2; exit 1; }

replay_status="$(post_payment "${OUT_DIR}/replay-response.json")"
test "$replay_status" = "200" \
  || { echo "멱등 재시도 HTTP=${replay_status}" >&2; cat "${OUT_DIR}/replay-response.json" >&2; exit 1; }

if ! cmp -s "${OUT_DIR}/first-response.json" "${OUT_DIR}/replay-response.json"; then
  echo "같은 Idempotency-Key 재시도의 응답이 최초 응답과 다릅니다." >&2
  exit 1
fi

# 현재 실행 묶음의 로그를 저장하고 세 서비스의 correlation ID를 확인한다.
docker compose --env-file .env logs --no-color --tail=500 \
  bookwave-app mock-pg haeon-card > "${OUT_DIR}/services.log" 2>&1 || true
: > "${OUT_DIR}/correlation-log-lines.txt"
missing=''
for service in bookwave-app mock-pg haeon-card; do
  if grep -F "$CORRELATION_ID" "${OUT_DIR}/services.log" | grep -F "[$service]" >> "${OUT_DIR}/correlation-log-lines.txt"; then
    :
  else
    missing="${missing} ${service}"
  fi
done

if test -n "$missing"; then
  echo "correlation ID를 찾지 못한 서비스:${missing}" >&2
  printf '{"runId":"%s","baseUrl":"%s","firstStatus":%s,"replayStatus":%s,"sameResponse":true,"missingLogServices":"%s","synthetic":true}\n' \
    "$RUN_ID" "$BOOKWAVE_URL" "$first_status" "$replay_status" "$missing" \
    > "${OUT_DIR}/run.json"
  exit 1
fi

printf '{"runId":"%s","baseUrl":"%s","firstStatus":%s,"replayStatus":%s,"sameResponse":true,"correlationId":"%s","logServices":["bookwave-app","mock-pg","haeon-card"],"synthetic":true}\n' \
  "$RUN_ID" "$BOOKWAVE_URL" "$first_status" "$replay_status" "$CORRELATION_ID" \
  > "${OUT_DIR}/run.json"

echo "전체 결제 API 계약 확인 완료: ${OUT_DIR}"

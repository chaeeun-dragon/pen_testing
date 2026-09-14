#!/usr/bin/env bash
set -euo pipefail

# 합성 카드 API 계약 확인기
#
# 정상 승인/거절 결과의 구조, 같은 키 재시도, 잘못된 Bearer 토큰 거절을
# 확인한다. 실제 카드번호·CVC·금융망은 사용하지 않는다.

BASE_URL="${HAEON_CARD_URL:-http://localhost:8084}"
RUN_ID="${RUN_ID:-CARD-CONTRACT-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT_DIR="${EVIDENCE_DIR:-evidence/runs}/${RUN_ID}"
MERCHANT_REQUEST_ID="${MERCHANT_REQUEST_ID:-${RUN_ID}-REQ}"
CORRELATION_ID="${CORRELATION_ID:-${RUN_ID}-CORR}"
TOKEN="${HAEON_MERCHANT_TOKEN:-lab-merchant-bookwave}"
AMOUNT="${AMOUNT:-10000}"

mkdir -p "$OUT_DIR"

fingerprint="$(printf '%064d' 0)"
requested_at="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
body="$(cat <<JSON
{
  "correlationId": "${CORRELATION_ID}",
  "merchantNo": "BOOKWAVE-LAB",
  "merchantRequestId": "${MERCHANT_REQUEST_ID}",
  "cardToken": "card-token-lab-001",
  "amount": ${AMOUNT},
  "currency": "KRW",
  "requestFingerprint": "${fingerprint}",
  "requestedAt": "${requested_at}"
}
JSON
)"

printf '%s\n' "$body" > "${OUT_DIR}/request.json"

health=''
for attempt in $(seq 1 30); do
  health="$(curl --silent --show-error --fail --max-time 3 \
    "${BASE_URL}/actuator/health" 2>/dev/null || true)"
  if printf '%s' "$health" | grep -q '"status":"UP"'; then
    break
  fi
  if test "$attempt" = 30; then
    echo "health가 30초 안에 UP이 되지 않았습니다." >&2
    exit 1
  fi
  sleep 1
done
printf '%s\n' "$health" > "${OUT_DIR}/health.json"

post_authorization() {
  local output="$1"
  curl --silent --show-error --max-time 15 \
    -H 'Content-Type: application/json' \
    -H "X-Correlation-Id: ${CORRELATION_ID}" \
    -H "Idempotency-Key: ${MERCHANT_REQUEST_ID}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "$body" \
    -o "$output" \
    -w '%{http_code}' \
    "${BASE_URL}/internal/v1/authorizations"
}

first_status="$(post_authorization "${OUT_DIR}/first-response.json")"
test "$first_status" = "200" \
  || { echo "첫 승인 요청 HTTP=${first_status}" >&2; cat "${OUT_DIR}/first-response.json" >&2; exit 1; }

second_status="$(post_authorization "${OUT_DIR}/replay-response.json")"
test "$second_status" = "200" \
  || { echo "멱등 재시도 HTTP=${second_status}" >&2; cat "${OUT_DIR}/replay-response.json" >&2; exit 1; }

first_auth="$(grep -o '"authorizationId":[0-9]*' "${OUT_DIR}/first-response.json" | head -1 | cut -d: -f2 || true)"
second_auth="$(grep -o '"authorizationId":[0-9]*' "${OUT_DIR}/replay-response.json" | head -1 | cut -d: -f2 || true)"
test -n "$first_auth" && test "$first_auth" = "$second_auth" \
  || { echo "멱등 재시도에서 authorizationId가 유지되지 않았습니다." >&2; exit 1; }

# 새 요청 ID와 잘못된 토큰을 사용해 인증 경계를 확인한다.
bad_body="${body/${CORRELATION_ID}/${CORRELATION_ID}-BAD}"
bad_body="${bad_body/${MERCHANT_REQUEST_ID}/${MERCHANT_REQUEST_ID}-BAD}"
bad_status="$(curl --silent --show-error --max-time 15 \
  -H 'Content-Type: application/json' \
  -H "X-Correlation-Id: ${CORRELATION_ID}-BAD" \
  -H "Idempotency-Key: ${MERCHANT_REQUEST_ID}-BAD" \
  -H 'Authorization: Bearer invalid-lab-token' \
  -d "$bad_body" \
  -o "${OUT_DIR}/invalid-token-response.json" \
  -w '%{http_code}' \
  "${BASE_URL}/internal/v1/authorizations")"
test "$bad_status" = "403" \
  || { echo "잘못된 토큰 요청이 HTTP 403이 아닙니다: ${bad_status}" >&2; exit 1; }
grep -q 'MERCHANT_NOT_ALLOWED' "${OUT_DIR}/invalid-token-response.json" \
  || { echo "잘못된 토큰 오류 코드가 없습니다." >&2; exit 1; }

printf '{"runId":"%s","baseUrl":"%s","firstStatus":%s,"replayStatus":%s,"invalidTokenStatus":%s,"sameAuthorizationId":true,"synthetic":true}\n' \
  "$RUN_ID" "$BASE_URL" "$first_status" "$second_status" "$bad_status" \
  > "${OUT_DIR}/run.json"

echo "카드 API 계약 확인 완료: ${OUT_DIR}"

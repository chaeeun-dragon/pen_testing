#!/usr/bin/env bash
set -euo pipefail

# CARD-03 Before/After 동시 요청 실행기
# 실행 전 LAB_PROFILE=before, BEFORE_BARRIER_ENABLED=true를 설정한다.
# 실제 카드번호·CVC 대신 합성 card-token만 사용한다.

BASE_URL="${HAEON_CARD_URL:-http://localhost:8084}"
RUN_ID="${RUN_ID:-HC03-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT_DIR="${EVIDENCE_DIR:-evidence/runs}/${RUN_ID}/requests"
PROFILE="${LAB_PROFILE:-unknown}"
SCENARIO_PROFILE="${CARD03_SCENARIO_PROFILE:-lab}"

case "$SCENARIO_PROFILE" in
  lab)
    DEFAULT_REQUEST_AMOUNT=80000
    ;;
  demo)
    # 시연용: 1천만원 한도에서 6백만원 요청 두 건을 동시에 보낸다.
    DEFAULT_REQUEST_AMOUNT=6000000
    ;;
  *)
    echo "CARD03_SCENARIO_PROFILE은 lab 또는 demo여야 합니다. 현재: ${SCENARIO_PROFILE}" >&2
    exit 2
    ;;
esac

REQUEST_AMOUNT="${CARD03_REQUEST_AMOUNT:-$DEFAULT_REQUEST_AMOUNT}"
BASELINE_USED_AMOUNT="${CARD03_BASELINE_USED_AMOUNT:-0}"
if [[ ! "$REQUEST_AMOUNT" =~ ^[0-9]+$ || "$REQUEST_AMOUNT" -le 0 ]]; then
  echo "CARD03_REQUEST_AMOUNT는 1 이상의 원 단위 정수여야 합니다. 현재: ${REQUEST_AMOUNT}" >&2
  exit 2
fi
if [[ ! "$BASELINE_USED_AMOUNT" =~ ^[0-9]+(\.[0-9]{1,2})?$ ]]; then
  echo "CARD03_BASELINE_USED_AMOUNT는 0 이상의 원 단위 금액이어야 합니다. 현재: ${BASELINE_USED_AMOUNT}" >&2
  exit 2
fi

mkdir -p "$OUT_DIR"

if [[ "$PROFILE" != "before" && "$PROFILE" != "after" ]]; then
  echo "LAB_PROFILE은 before 또는 after로 설정해야 합니다. 현재: ${PROFILE}" >&2
  exit 2
fi

send_request() {
  local suffix="$1"
  local corr="${RUN_ID}-${suffix}"
  local key="HC03-REQ-${suffix}"
  local fingerprint
  fingerprint="$(printf '%*s' 64 '' | tr ' ' "${suffix,,}")"
  local body
  body="$(cat <<JSON
{
  "correlationId": "${corr}",
  "merchantNo": "BOOKWAVE-LAB",
  "merchantRequestId": "${key}",
  "cardToken": "card-token-lab-001",
  "amount": ${REQUEST_AMOUNT},
  "currency": "KRW",
  "requestFingerprint": "${fingerprint}",
  "requestedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
}
JSON
  )"

  curl --silent --show-error --fail-with-body \
    --max-time 15 \
    -H 'Content-Type: application/json' \
    -H "X-Correlation-Id: ${corr}" \
    -H "Idempotency-Key: ${key}" \
    -H "Authorization: Bearer ${HAEON_MERCHANT_TOKEN:-lab-merchant-bookwave}" \
    -d "$body" \
    "${BASE_URL}/internal/v1/authorizations" \
    > "${OUT_DIR}/request-${suffix}.json"
}

send_request A & pid_a=$!
send_request B & pid_b=$!

status=0
wait "$pid_a" || status=$?
wait "$pid_b" || status=$?

printf '{"run_id":"%s","profile":"%s","scenario_profile":"%s","base_url":"%s","request_amount":%s,"request_count":2,"baseline_used_amount":%s,"correlation_ids":["%s-A","%s-B"],"merchant_request_ids":["HC03-REQ-A","HC03-REQ-B"],"status":%d}\n' \
  "$RUN_ID" "$PROFILE" "$SCENARIO_PROFILE" "$BASE_URL" "$REQUEST_AMOUNT" "$BASELINE_USED_AMOUNT" \
  "$RUN_ID" "$RUN_ID" "$status" > "${OUT_DIR}/run.json"

if [[ "$status" -ne 0 ]]; then
  echo "CARD-03 요청 중 하나 이상 실패했습니다. 응답 파일과 서비스 로그를 확인하세요." >&2
  exit "$status"
fi

echo "CARD-03 두 요청 완료: ${OUT_DIR}"

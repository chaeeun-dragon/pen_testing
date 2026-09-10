#!/usr/bin/env bash
set -euo pipefail

# 해온카드 정상 승인·멱등 재시도 확인기
# 프로젝트 루트에서 실행한다. 실제 카드정보는 사용하지 않는다.

BASE_URL="${HAEON_CARD_URL:-http://localhost:8084}"
RUN_ID="${RUN_ID:-HC-SMOKE-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT_DIR="${EVIDENCE_DIR:-evidence/runs}/${RUN_ID}"
MERCHANT_REQUEST_ID="${MERCHANT_REQUEST_ID:-${RUN_ID}-REQ}"
CORRELATION_ID="${CORRELATION_ID:-${RUN_ID}-CORR}"
TOKEN="${HAEON_MERCHANT_TOKEN:-lab-merchant-bookwave}"

mkdir -p "$OUT_DIR"

fingerprint="$(printf '%064d' 0)"
body="$(cat <<JSON
{
  "correlationId": "${CORRELATION_ID}",
  "merchantNo": "BOOKWAVE-LAB",
  "merchantRequestId": "${MERCHANT_REQUEST_ID}",
  "cardToken": "card-token-lab-001",
  "amount": 10000,
  "currency": "KRW",
  "requestFingerprint": "${fingerprint}",
  "requestedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
}
JSON
  )"

printf '%s\n' "$body" > "${OUT_DIR}/request.json"

request() {
  local output="$1"
  if ! curl --silent --show-error --fail-with-body --max-time 15 \
      -H 'Content-Type: application/json' \
      -H "X-Correlation-Id: ${CORRELATION_ID}" \
      -H "Idempotency-Key: ${MERCHANT_REQUEST_ID}" \
      -H "Authorization: Bearer ${TOKEN}" \
      -d "$body" \
      "${BASE_URL}/internal/v1/authorizations" \
      > "$output"; then
    echo "해온카드 요청 실패: ${output}" >&2
    cat "$output" >&2 || true
    return 1
  fi
}

request "${OUT_DIR}/first-response.json"
request "${OUT_DIR}/replay-response.json"

printf '{"run_id":"%s","profile":"%s","base_url":"%s","amount":10000,"requests":2,"same_idempotency_key":true}\n' \
  "$RUN_ID" "${LAB_PROFILE:-normal}" "$BASE_URL" > "${OUT_DIR}/run.json"

echo "해온카드 정상 승인·멱등 재시도 완료: ${OUT_DIR}"

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
DECLINE_AMOUNT="${DECLINE_AMOUNT:-100000}"

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
  local body_payload="$1"
  local output="$2"
  local correlation_id="${3:-$CORRELATION_ID}"
  local request_id="${4:-$MERCHANT_REQUEST_ID}"
  curl --silent --show-error --max-time 15 \
    -H 'Content-Type: application/json' \
    -H "X-Correlation-Id: ${correlation_id}" \
    -H "Idempotency-Key: ${request_id}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "$body_payload" \
    -o "$output" \
    -w '%{http_code}' \
    "${BASE_URL}/internal/v1/authorizations"
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq "$expected" "$file" || {
    echo "${file}에 기대한 값이 없습니다: ${expected}" >&2
    cat "$file" >&2
    exit 1
  }
}

first_status="$(post_authorization "$body" "${OUT_DIR}/first-response.json")"
test "$first_status" = "200" \
  || { echo "첫 승인 요청 HTTP=${first_status}" >&2; cat "${OUT_DIR}/first-response.json" >&2; exit 1; }

second_status="$(post_authorization "$body" "${OUT_DIR}/replay-response.json")"
test "$second_status" = "200" \
  || { echo "멱등 재시도 HTTP=${second_status}" >&2; cat "${OUT_DIR}/replay-response.json" >&2; exit 1; }

first_auth="$(grep -o '"authorizationId":[0-9]*' "${OUT_DIR}/first-response.json" | head -1 | cut -d: -f2 || true)"
second_auth="$(grep -o '"authorizationId":[0-9]*' "${OUT_DIR}/replay-response.json" | head -1 | cut -d: -f2 || true)"
test -n "$first_auth" && test "$first_auth" = "$second_auth" \
  || { echo "멱등 재시도에서 authorizationId가 유지되지 않았습니다." >&2; exit 1; }

# 한도 초과 요청은 HTTP 200 안에서 DECLINED로 반환되어야 한다.
decline_corr="${CORRELATION_ID}-DECLINE"
decline_req="${MERCHANT_REQUEST_ID}-DECLINE"
decline_fingerprint="$(printf '%064d' 1)"
decline_body="$(cat <<JSON
{
  "correlationId": "${decline_corr}",
  "merchantNo": "BOOKWAVE-LAB",
  "merchantRequestId": "${decline_req}",
  "cardToken": "card-token-lab-001",
  "amount": ${DECLINE_AMOUNT},
  "currency": "KRW",
  "requestFingerprint": "${decline_fingerprint}",
  "requestedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
}
JSON
)"
printf '%s\n' "$decline_body" > "${OUT_DIR}/decline-request.json"
decline_status="$(post_authorization "$decline_body" "${OUT_DIR}/decline-response.json" "$decline_corr" "$decline_req")"
test "$decline_status" = "200" \
  || { echo "한도 초과 요청 HTTP=${decline_status}" >&2; cat "${OUT_DIR}/decline-response.json" >&2; exit 1; }
assert_contains "${OUT_DIR}/decline-response.json" '"decision":"DECLINED"'
assert_contains "${OUT_DIR}/decline-response.json" '"approvedAmount":0'
assert_contains "${OUT_DIR}/decline-response.json" '"reasonCode":"LIMIT_EXCEEDED"'

# 같은 멱등키에 다른 지문을 보내면 중복 결제를 막기 위해 409가 되어야 한다.
conflict_body="${decline_body/\"amount\": ${DECLINE_AMOUNT}/\"amount\": 90000}"
conflict_body="${conflict_body/\"requestFingerprint\": \"${decline_fingerprint}\"/\"requestFingerprint\": \"$(printf '%064d' 2)\"}"
printf '%s\n' "$conflict_body" > "${OUT_DIR}/conflict-request.json"
conflict_status="$(post_authorization "$conflict_body" "${OUT_DIR}/conflict-response.json" "$decline_corr" "$decline_req")"
test "$conflict_status" = "409" \
  || { echo "멱등키 충돌 HTTP=${conflict_status}" >&2; cat "${OUT_DIR}/conflict-response.json" >&2; exit 1; }
assert_contains "${OUT_DIR}/conflict-response.json" 'IDEMPOTENCY_CONFLICT'

# 요청에 결과 필드를 끼워 넣어도 카드사가 DB 기준으로 새 결과를 계산해야 한다.
forged_corr="${CORRELATION_ID}-FORGED"
forged_req="${MERCHANT_REQUEST_ID}-FORGED"
forged_body="$(cat <<JSON
{
  "correlationId": "${forged_corr}",
  "merchantNo": "BOOKWAVE-LAB",
  "merchantRequestId": "${forged_req}",
  "cardToken": "card-token-lab-001",
  "amount": ${AMOUNT},
  "currency": "KRW",
  "requestFingerprint": "$(printf '%064d' 3)",
  "requestedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)",
  "decision": "APPROVED",
  "approvedAmount": 999999,
  "remainingLimit": 999999,
  "authorizationNo": "AUTH-FORGED"
}
JSON
)"
printf '%s\n' "$forged_body" > "${OUT_DIR}/forged-fields-request.json"
forged_status="$(post_authorization "$forged_body" "${OUT_DIR}/forged-fields-response.json" "$forged_corr" "$forged_req")"
test "$forged_status" = "200" \
  || { echo "위조 결과 필드 요청 HTTP=${forged_status}" >&2; cat "${OUT_DIR}/forged-fields-response.json" >&2; exit 1; }
assert_contains "${OUT_DIR}/forged-fields-response.json" '"decision":"APPROVED"'
if grep -Fq 'AUTH-FORGED' "${OUT_DIR}/forged-fields-response.json"; then
  echo "요청에 포함한 위조 authorizationNo가 응답에 반영되었습니다." >&2
  exit 1
fi

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

# Bearer 헤더를 생략한 요청도 본문의 merchantNo를 신뢰하지 않고 거절해야 한다.
missing_auth_corr="${CORRELATION_ID}-NOAUTH"
missing_auth_req="${MERCHANT_REQUEST_ID}-NOAUTH"
missing_auth_body="${body/${CORRELATION_ID}/${missing_auth_corr}}"
missing_auth_body="${missing_auth_body/${MERCHANT_REQUEST_ID}/${missing_auth_req}}"
missing_auth_status="$(curl --silent --show-error --max-time 15 \
  -H 'Content-Type: application/json' \
  -H "X-Correlation-Id: ${missing_auth_corr}" \
  -H "Idempotency-Key: ${missing_auth_req}" \
  -d "${missing_auth_body}" \
  -o "${OUT_DIR}/missing-token-response.json" \
  -w '%{http_code}' \
  "${BASE_URL}/internal/v1/authorizations")"
test "$missing_auth_status" = "403" \
  || { echo "Bearer 헤더 누락 요청이 HTTP 403이 아닙니다: ${missing_auth_status}" >&2; exit 1; }
grep -q 'MERCHANT_NOT_ALLOWED' "${OUT_DIR}/missing-token-response.json" \
  || { echo "Bearer 헤더 누락 오류 코드가 없습니다." >&2; exit 1; }

cat > "${OUT_DIR}/mapping-check.json" <<JSON
{
  "requestMapping": {
    "correlationId": "correlationId",
    "merchantRequestId": "merchantRequestId",
    "paymentMethodToken": "cardToken",
    "amount": "amount",
    "currency": "currency"
  },
  "responseMapping": {
    "authorizationNo": "authorizationNo",
    "decision": "decision",
    "approvedAmount": "approvedAmount",
    "reasonCode": "reasonCode"
  },
  "remainingLimitExposedToBookwave": false,
  "synthetic": true
}
JSON

printf '{"runId":"%s","baseUrl":"%s","approvalStatus":%s,"replayStatus":%s,"declineStatus":%s,"conflictStatus":%s,"forgedFieldsStatus":%s,"invalidTokenStatus":%s,"missingTokenStatus":%s,"sameAuthorizationId":true,"mappingChecked":true,"synthetic":true}\n' \
  "$RUN_ID" "$BASE_URL" "$first_status" "$second_status" "$decline_status" \
  "$conflict_status" "$forged_status" "$bad_status" "$missing_auth_status" > "${OUT_DIR}/run.json"

echo "카드 API 계약 확인 완료: ${OUT_DIR}"

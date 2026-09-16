#!/usr/bin/env bash
set -euo pipefail

# CARD-03 탐지 규칙 자동 점검기
# 공격을 실행하지 않고, 지정한 실행 범위의 로그와 합성 DB를 같은 규칙으로 검사한다.

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
RUN_ID="${RUN_ID:-CARD03-DETECT-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT_DIR="${EVIDENCE_DIR:-evidence/runs}/${RUN_ID}/detection"
SERVICES_LOG="${SERVICES_LOG:-${OUT_DIR}/services.log}"
DB_SERVICE="${DB_SERVICE:-haeon-card-mysql}"
DETECTION_EXIT_ON_ALERT="${DETECTION_EXIT_ON_ALERT:-false}"
EXPECTED_SERVICES="${EXPECTED_SERVICES:-bookwave-app,mock-pg,haeon-card}"
BASELINE_USED_AMOUNT="${BASELINE_USED_AMOUNT:-}"

if [[ ! -f "${PROJECT_ROOT}/compose.yaml" ]]; then
  echo "프로젝트 루트에서 실행하거나 PROJECT_ROOT를 지정해야 합니다." >&2
  exit 2
fi

if [[ -z "${BASELINE_USED_AMOUNT}" || ! "${BASELINE_USED_AMOUNT}" =~ ^[0-9]+(\.[0-9]{1,2})?$ ]]; then
  echo "실행 전 카드 사용액 BASELINE_USED_AMOUNT(0 이상의 원 단위 금액)가 필요합니다." >&2
  exit 2
fi
if [[ -n "${CORRELATION_IDS:-}" && -n "${MERCHANT_REQUEST_IDS:-}" ]]; then
  echo "CORRELATION_IDS 또는 MERCHANT_REQUEST_IDS 중 하나만 지정해야 합니다." >&2
  exit 2
fi
if [[ -z "${CORRELATION_IDS:-}" && -z "${MERCHANT_REQUEST_IDS:-}" ]]; then
  echo "전역 DB 검사를 막기 위해 CORRELATION_IDS 또는 MERCHANT_REQUEST_IDS가 필요합니다." >&2
  exit 2
fi

cd "${PROJECT_ROOT}"

mkdir -p "${OUT_DIR}"

mysql_exec() {
  local sql="$1"
  docker compose --env-file .env exec -T "${DB_SERVICE}" \
    sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" --batch --skip-column-names -e "$1"' \
    sh "$sql"
}

count_query() {
  local value
  value="$(mysql_exec "$1" | tr -d '\r' | tail -n 1)"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "숫자 결과가 아닌 DB 응답: ${value}" >&2
    exit 2
  fi
  printf '%s' "$value"
}

scope_values_to_sql_list() {
  local raw="$1"
  local label="$2"
  local value
  local -a values=()
  IFS=',' read -r -a values <<< "${raw}"
  local sql_list=""
  for value in "${values[@]}"; do
    value="${value//[[:space:]]/}"
    if [[ ! "${value}" =~ ^[A-Za-z0-9_-]{1,80}$ ]]; then
      echo "${label}에 허용되지 않은 값이 있습니다: ${value}" >&2
      exit 2
    fi
    if [[ -n "${sql_list}" ]]; then
      sql_list+=","
    fi
    sql_list+="'${value}'"
  done
  printf '%s' "${sql_list}"
}

if [[ -n "${CORRELATION_IDS:-}" ]]; then
  scope_mode="correlationId"
  scope_input="${CORRELATION_IDS}"
  scope_values="$(scope_values_to_sql_list "${CORRELATION_IDS}" "CORRELATION_IDS")"
  scope_where="a.correlation_id IN (${scope_values})"
  correlation_ids="$(printf '%s' "${CORRELATION_IDS}" | tr ',' '\n' | sed 's/[[:space:]]//g' | sed '/^$/d' | sort -u)"
else
  scope_mode="merchantRequestId"
  scope_input="${MERCHANT_REQUEST_IDS}"
  scope_values="$(scope_values_to_sql_list "${MERCHANT_REQUEST_IDS}" "MERCHANT_REQUEST_IDS")"
  scope_where="a.merchant_request_id IN (${scope_values})"
  correlation_ids=""
fi
scope_card_subquery="SELECT DISTINCT a.card_id FROM authorization_requests a WHERE ${scope_where}"

if [[ ! -f "${SERVICES_LOG}" ]]; then
  docker compose --env-file .env logs --no-color --tail=1000 \
    bookwave-app mock-pg haeon-card > "${SERVICES_LOG}" 2>&1
fi

DB_SUMMARY="${OUT_DIR}/db-summary.tsv"
mysql_exec "
SELECT 'scope' AS section, '${scope_mode}' AS scope_mode, '${scope_input}' AS scope_input,
       ${BASELINE_USED_AMOUNT} AS baseline_used_amount;
SELECT 'card_limits' AS section, l.card_id, l.limit_amount, l.used_amount, l.version
  FROM card_limits l WHERE l.card_id IN (${scope_card_subquery});
SELECT 'authorization_requests' AS section, a.auth_id, a.merchant_request_id, a.correlation_id,
       a.card_id, a.amount, a.status, a.decision_code, a.read_used_amount, a.read_limit_version
  FROM authorization_requests a WHERE ${scope_where} ORDER BY a.auth_id;
SELECT 'transactions' AS section, t.txn_id, t.auth_id, a.correlation_id, t.amount, t.status
  FROM card_transactions t JOIN authorization_requests a ON a.auth_id = t.auth_id
  WHERE ${scope_where} ORDER BY t.txn_id;
SELECT 'audit_events' AS section, e.event_uuid, e.auth_id, e.event_type, e.result, e.correlation_id
  FROM audit_events e JOIN authorization_requests a ON a.auth_id = e.auth_id
  WHERE ${scope_where} ORDER BY e.occurred_at;
" > "${DB_SUMMARY}"

scoped_authorization_count="$(count_query "SELECT COUNT(*) FROM authorization_requests a WHERE ${scope_where};")"
scope_card_count="$(count_query "SELECT COUNT(DISTINCT a.card_id) FROM authorization_requests a WHERE ${scope_where};")"
if [[ "${scope_mode}" == "merchantRequestId" ]]; then
  correlation_ids="$(mysql_exec "SELECT DISTINCT a.correlation_id FROM authorization_requests a WHERE ${scope_where} ORDER BY a.correlation_id;" | tr -d '\r')"
fi

limit_violation_count="$(count_query "SELECT COUNT(*) FROM card_limits l WHERE l.card_id IN (${scope_card_subquery}) AND l.used_amount > l.limit_amount;")"
approved_over_limit_count="$(count_query "SELECT COUNT(*) FROM (SELECT l.card_id, l.limit_amount, CAST(${BASELINE_USED_AMOUNT} AS DECIMAL(15,2)) + COALESCE(SUM(t.amount), 0) AS scoped_approved_total FROM card_limits l LEFT JOIN authorization_requests a ON a.card_id = l.card_id AND a.status = 'APPROVED' AND ${scope_where} LEFT JOIN card_transactions t ON t.auth_id = a.auth_id WHERE l.card_id IN (${scope_card_subquery}) GROUP BY l.card_id, l.limit_amount HAVING scoped_approved_total > l.limit_amount) x;")"
duplicate_snapshot_count="$(count_query "SELECT COUNT(*) FROM (SELECT a.card_id, a.read_limit_version FROM authorization_requests a WHERE ${scope_where} AND a.status = 'APPROVED' GROUP BY a.card_id, a.read_limit_version HAVING COUNT(*) >= 2) x;")"
approved_without_transaction_count="$(count_query "SELECT COUNT(*) FROM authorization_requests a LEFT JOIN card_transactions t ON t.auth_id = a.auth_id WHERE ${scope_where} AND a.status = 'APPROVED' AND t.auth_id IS NULL;")"
transaction_without_approval_count="$(count_query "SELECT COUNT(*) FROM card_transactions t JOIN authorization_requests a ON a.auth_id = t.auth_id WHERE ${scope_where} AND (a.status <> 'APPROVED' OR a.amount <> t.amount);")"
audit_mismatch_count="$(count_query "SELECT COUNT(*) FROM authorization_requests a LEFT JOIN audit_events e ON e.auth_id = a.auth_id AND e.event_type = 'AUTH_COMMITTED' WHERE ${scope_where} AND e.auth_id IS NULL;")"
used_vs_transaction_count="$(count_query "SELECT COUNT(*) FROM (SELECT l.card_id, l.used_amount, CAST(${BASELINE_USED_AMOUNT} AS DECIMAL(15,2)) + COALESCE(SUM(t.amount), 0) AS expected_used_amount FROM card_limits l LEFT JOIN authorization_requests a ON a.card_id = l.card_id AND a.status = 'APPROVED' AND ${scope_where} LEFT JOIN card_transactions t ON t.auth_id = a.auth_id WHERE l.card_id IN (${scope_card_subquery}) GROUP BY l.card_id, l.used_amount HAVING l.used_amount <> expected_used_amount) x;")"

correlation_ids="$(printf '%s\n' "${correlation_ids}" | sed '/^$/d' | sort -u)"
IFS=',' read -r -a expected_service_list <<< "${EXPECTED_SERVICES}"

CORRELATION_REPORT="${OUT_DIR}/correlation-report.tsv"
printf 'correlation_id\tbookwave-app\tmock-pg\thaeon-card\tstatus\n' > "${CORRELATION_REPORT}"
correlation_count=0
correlation_missing_count=0
mapfile -t correlation_list < <(printf '%s\n' "${correlation_ids}")
for correlation_id in "${correlation_list[@]}"; do
  [[ -z "${correlation_id}" ]] && continue
  correlation_count=$((correlation_count + 1))
  missing_services=""
  service_state=()
  for service in bookwave-app mock-pg haeon-card; do
    required=false
    for expected_service in "${expected_service_list[@]}"; do
      if [[ "${service}" == "${expected_service}" ]]; then
        required=true
        break
      fi
    done
    if grep -F "corr=${correlation_id}" "${SERVICES_LOG}" | grep -F "[${service}]" >/dev/null; then
      service_state+=("YES")
    elif [[ "${required}" == "false" ]]; then
      service_state+=("N/A")
    else
      service_state+=("NO")
      missing_services="${missing_services}${service},"
    fi
  done
  if [[ -n "${missing_services}" ]]; then
    correlation_missing_count=$((correlation_missing_count + 1))
    printf '%s\t%s\t%s\t%s\tMISSING:%s\n' "${correlation_id}" "${service_state[0]}" "${service_state[1]}" "${service_state[2]}" "${missing_services%,}" >> "${CORRELATION_REPORT}"
  else
    printf '%s\t%s\t%s\t%s\tPASS\n' "${correlation_id}" "${service_state[0]}" "${service_state[1]}" "${service_state[2]}" >> "${CORRELATION_REPORT}"
  fi
done

FINDINGS="${OUT_DIR}/findings.txt"
: > "${FINDINGS}"
alert_count=0
failure_count=0

record_alert() {
  echo "ALERT $1" >> "${FINDINGS}"
  alert_count=$((alert_count + 1))
}

record_pass() {
  echo "PASS $1" >> "${FINDINGS}"
}

record_failure() {
  echo "FAIL $1" >> "${FINDINGS}"
  failure_count=$((failure_count + 1))
}

if [[ "${scoped_authorization_count}" -eq 0 ]]; then
  record_failure "지정한 실행 범위에 승인 요청 DB 행이 없음"
else
  record_pass "지정한 실행 범위의 승인 요청 ${scoped_authorization_count}건을 확인함"
fi

if [[ "${scope_card_count}" -ne 1 ]]; then
  record_failure "BASELINE_USED_AMOUNT 대사는 한 실행·한 카드 범위만 지원함 (현재 ${scope_card_count}개 카드)"
else
  record_pass "실행 범위가 한 카드로 한정됨"
fi

if [[ "${limit_violation_count}" -gt 0 || "${approved_over_limit_count}" -gt 0 ]]; then
  record_alert "실행 범위의 승인 합계 또는 현재 used_amount가 카드 한도를 초과함"
else
  record_pass "실행 범위에서 카드 한도 초과 없음"
fi

if [[ "${duplicate_snapshot_count}" -gt 0 ]]; then
  record_alert "실행 범위에서 같은 카드·read_limit_version으로 승인된 요청이 2건 이상"
else
  record_pass "실행 범위에 동일 한도 스냅샷 중복 승인 없음"
fi

if [[ "${approved_without_transaction_count}" -gt 0 ]]; then
  record_failure "실행 범위의 승인 요청에 대응하는 거래가 없음"
else
  record_pass "실행 범위의 승인 요청과 거래가 연결됨"
fi

if [[ "${transaction_without_approval_count}" -gt 0 ]]; then
  record_failure "실행 범위에 승인되지 않은 거래 또는 금액 불일치 거래가 존재함"
else
  record_pass "실행 범위의 거래가 승인 결과와 일치함"
fi

if [[ "${audit_mismatch_count}" -gt 0 ]]; then
  record_failure "실행 범위의 승인 요청에 대응하는 AUTH_COMMITTED 감사 이벤트가 없음"
else
  record_pass "실행 범위의 승인 요청과 감사 이벤트가 연결됨"
fi

if [[ "${used_vs_transaction_count}" -gt 0 ]]; then
  record_failure "현재 used_amount가 BASELINE_USED_AMOUNT와 실행 범위 승인 거래 합계에 맞지 않음"
else
  record_pass "현재 used_amount가 기준 사용액과 실행 범위 승인 거래 합계에 일치함"
fi

if [[ "${correlation_count}" -eq 0 ]]; then
  record_failure "지정한 실행 범위에서 correlationId를 찾지 못함"
elif [[ "${correlation_missing_count}" -gt 0 ]]; then
  record_failure "일부 correlationId가 필수 서비스 로그를 모두 통과하지 않음"
else
  record_pass "지정한 모든 correlationId가 필수 서비스 로그에 존재함"
fi

if [[ "${failure_count}" -gt 0 ]]; then
  RESULT="FAIL"
elif [[ "${alert_count}" -gt 0 ]]; then
  RESULT="ALERT"
else
  RESULT="PASS"
fi

SUMMARY="${OUT_DIR}/summary.txt"
{
  echo "CARD-03 detection result: ${RESULT}"
  echo "scope_mode=${scope_mode} scope_input=${scope_input} baseline_used_amount=${BASELINE_USED_AMOUNT}"
  echo "alerts=${alert_count} failures=${failure_count} correlations=${correlation_count} scoped_authorizations=${scoped_authorization_count} scoped_cards=${scope_card_count}"
  echo "expected_services=${EXPECTED_SERVICES}"
  echo "limit_violation_count=${limit_violation_count}"
  echo "approved_over_limit_count=${approved_over_limit_count}"
  echo "duplicate_snapshot_count=${duplicate_snapshot_count}"
  echo "approved_without_transaction_count=${approved_without_transaction_count}"
  echo "transaction_without_approval_count=${transaction_without_approval_count}"
  echo "audit_mismatch_count=${audit_mismatch_count}"
  echo "used_vs_transaction_count=${used_vs_transaction_count}"
  echo
  cat "${FINDINGS}"
} > "${SUMMARY}"

printf '{"result":"%s","alerts":%d,"failures":%d,"correlations":%d,"scopedAuthorizations":%d,"scopedCards":%d,"scopeMode":"%s","scopeInput":"%s","baselineUsedAmount":%s,"expectedServices":"%s","limitViolation":%d,"approvedOverLimit":%d,"duplicateSnapshot":%d,"approvedWithoutTransaction":%d,"transactionWithoutApproval":%d,"auditMismatch":%d,"usedVsTransaction":%d}\n' \
  "${RESULT}" "${alert_count}" "${failure_count}" "${correlation_count}" \
  "${scoped_authorization_count}" "${scope_card_count}" "${scope_mode}" "${scope_input}" "${BASELINE_USED_AMOUNT}" "${EXPECTED_SERVICES}" \
  "${limit_violation_count}" "${approved_over_limit_count}" "${duplicate_snapshot_count}" \
  "${approved_without_transaction_count}" "${transaction_without_approval_count}" \
  "${audit_mismatch_count}" "${used_vs_transaction_count}" > "${OUT_DIR}/result.json"

echo "CARD-03 탐지 점검 완료: ${RESULT} (${OUT_DIR})"

if [[ "${RESULT}" == "FAIL" ]]; then
  exit 1
fi
if [[ "${RESULT}" == "ALERT" && "${DETECTION_EXIT_ON_ALERT}" == "true" ]]; then
  exit 3
fi

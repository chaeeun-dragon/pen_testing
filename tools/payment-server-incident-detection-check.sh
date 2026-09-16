#!/usr/bin/env bash
set -euo pipefail

# Scope-limited detector for the fixed, synthetic payment-server incident sequence.
# It reads saved logs only; it never calls payment, Mock PG, Haeon Card, or either database.

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
RUN_ID="${RUN_ID:?RUN_ID must be set}"
CORRELATION_ID="${CORRELATION_ID:?CORRELATION_ID must be set}"
EVIDENCE_ROOT="${EVIDENCE_DIR:-evidence/runs}"
SERVICES_LOG="${SERVICES_LOG:-${EVIDENCE_ROOT}/${RUN_ID}/services.log}"
OUT_DIR="${DETECTION_DIR:-${EVIDENCE_ROOT}/${RUN_ID}/detection}"

if [[ ! "${RUN_ID}" =~ ^INCIDENT-SIM-[A-Za-z0-9_-]{8,80}$ ]]; then
  echo "RUN_ID must match INCIDENT-SIM-[A-Za-z0-9_-]{8,80}." >&2
  exit 2
fi
if [[ ! "${CORRELATION_ID}" =~ ^[A-Za-z0-9_-]{8,80}$ ]]; then
  echo "CORRELATION_ID must be an 8-80 character ASCII identifier." >&2
  exit 2
fi
if [[ ! -d "${PROJECT_ROOT}" || ! -f "${PROJECT_ROOT}/compose.yaml" ]]; then
  echo "Run from the project root or set PROJECT_ROOT." >&2
  exit 2
fi
if [[ ! -f "${SERVICES_LOG}" ]]; then
  echo "Saved SERVICES_LOG is required: ${SERVICES_LOG}" >&2
  exit 2
fi

mkdir -p "${OUT_DIR}"
SCOPED_LOG="${OUT_DIR}/scoped-services.log"
grep -F "corr=${CORRELATION_ID}" "${SERVICES_LOG}" | grep -F "runId=${RUN_ID}" > "${SCOPED_LOG}" || true

write_failure() {
  local reason="$1"
  printf '{"runId":"%s","correlationId":"%s","simulation":true,"result":"FAIL","reason":"%s"}\n' \
    "${RUN_ID}" "${CORRELATION_ID}" "${reason}" > "${OUT_DIR}/result.json"
  printf '결제 서버 침입 징후 탐지 FAIL: %s\n' "${reason}" > "${OUT_DIR}/summary.txt"
  echo "Incident detection FAIL: ${reason}" >&2
  exit 1
}

if [[ ! -s "${SCOPED_LOG}" ]]; then
  write_failure "NO_SCOPED_CORRELATION_LOG"
fi

declare -a expected_events=(
  "incident_simulation_started:RECORDED"
  "simulated_payment_server_access_detected:OBSERVED"
  "simulated_synthetic_data_access_attempted:OBSERVED"
  "incident_simulation_alert_raised:ALERT"
  "simulated_synthetic_data_access_blocked:BLOCKED"
  "incident_simulation_additional_verification_passed:PASS"
  "incident_simulation_completed:PASS"
)

previous_line=0
event_order=""
for expected in "${expected_events[@]}"; do
  event="${expected%%:*}"
  result="${expected##*:}"
  matches="$(grep -n -F "event=${event}" "${SCOPED_LOG}" || true)"
  if [[ -z "${matches}" ]]; then
    write_failure "MISSING_${event}"
  fi
  if [[ "$(printf '%s\n' "${matches}" | wc -l | tr -d ' ')" != "1" ]]; then
    write_failure "DUPLICATE_${event}"
  fi
  line_number="${matches%%:*}"
  line_text="${matches#*:}"
  if [[ "${line_text}" != *"result=${result}"* ]]; then
    write_failure "UNEXPECTED_RESULT_${event}"
  fi
  if (( line_number <= previous_line )); then
    write_failure "OUT_OF_ORDER_${event}"
  fi
  previous_line="${line_number}"
  event_order+="${event},"
done

if grep -E '^(mock-pg|haeon-card)(-|[[:space:]])' "${SCOPED_LOG}" >/dev/null; then
  write_failure "UNEXPECTED_DOWNSTREAM_CORRELATION"
fi

printf '{"runId":"%s","correlationId":"%s","simulation":true,"detection":"ALERT","containment":"PASS","result":"PASS","eventOrderVerified":true,"mockPgCorrelationObserved":false,"haeonCardCorrelationObserved":false}\n' \
  "${RUN_ID}" "${CORRELATION_ID}" > "${OUT_DIR}/result.json"
printf '단계\t이벤트\t판정\nS1\tsimulated_payment_server_access_detected\tOBSERVED\nS2\tsimulated_synthetic_data_access_attempted\tOBSERVED\nS3\tincident_simulation_alert_raised\tALERT\nS4\tsimulated_synthetic_data_access_blocked\tBLOCKED\nS4\tincident_simulation_additional_verification_passed\tPASS\nS4\tincident_simulation_completed\tPASS\n' \
  > "${OUT_DIR}/event-sequence.tsv"
printf 'service\tcorrelationIdObserved\nbookwave-app\tyes\nmock-pg\tno (expected)\nhaeon-card\tno (expected)\n' \
  > "${OUT_DIR}/correlation-report.tsv"
printf '결제 서버 침입 징후 탐지 PASS: S1·S2 합성 관측 뒤 S3 ALERT, S4 차단 및 추가 검증 PASS를 같은 correlationId 범위에서 확인했다. Mock PG와 해온카드 상관 로그는 없다.\n' \
  > "${OUT_DIR}/summary.txt"

echo "Incident detection PASS: ${OUT_DIR}"

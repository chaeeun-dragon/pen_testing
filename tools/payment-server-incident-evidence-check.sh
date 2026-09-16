#!/usr/bin/env bash
set -euo pipefail

# Verifies an already-created incident evidence package. It reads saved artifacts only and never
# calls the simulation route, a payment route, Mock PG, Haeon Card, or a database.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
RUN_ID="${RUN_ID:?RUN_ID must be set}"
CORRELATION_ID="${CORRELATION_ID:?CORRELATION_ID must be set}"
EVIDENCE_ROOT="${EVIDENCE_DIR:-${PROJECT_ROOT}/evidence/runs}"
OUT_DIR="${EVIDENCE_ROOT}/${RUN_ID}"

if [[ ! "${RUN_ID}" =~ ^INCIDENT-SIM-[A-Za-z0-9_-]{8,80}$ ]]; then
  echo "RUN_ID must match INCIDENT-SIM-[A-Za-z0-9_-]{8,80}." >&2
  exit 2
fi
if [[ ! "${CORRELATION_ID}" =~ ^[A-Za-z0-9_-]{8,80}$ ]]; then
  echo "CORRELATION_ID must be an 8-80 character ASCII identifier." >&2
  exit 2
fi
if [[ ! -f "${PROJECT_ROOT}/compose.yaml" || ! -d "${OUT_DIR}" ]]; then
  echo "Project root or evidence directory is invalid." >&2
  exit 2
fi

write_failure() {
  local reason="$1"
  printf '{"runId":"%s","correlationId":"%s","result":"FAIL","reason":"%s"}\n' \
    "${RUN_ID}" "${CORRELATION_ID}" "${reason}" > "${OUT_DIR}/evidence-check.json"
  echo "Incident evidence check FAIL: ${reason}" >&2
  exit 1
}

required_files=(
  "scenario.json"
  "request.json"
  "response.json"
  "bookwave-health.json"
  "services.log"
  "result.json"
  "summary.txt"
  "correlation-report.tsv"
  "detection/result.json"
  "detection/summary.txt"
  "detection/event-sequence.tsv"
  "detection/correlation-report.tsv"
)

for relative_path in "${required_files[@]}"; do
  [[ -s "${OUT_DIR}/${relative_path}" ]] || write_failure "MISSING_${relative_path//\//_}"
done

grep -Fq "\"runId\":\"${RUN_ID}\"" "${OUT_DIR}/scenario.json" \
  || write_failure "SCENARIO_RUN_ID_MISMATCH"
grep -Fq "\"correlationId\":\"${CORRELATION_ID}\"" "${OUT_DIR}/scenario.json" \
  || write_failure "SCENARIO_CORRELATION_ID_MISMATCH"
grep -Fq '"simulation":true' "${OUT_DIR}/scenario.json" \
  || write_failure "SCENARIO_NOT_SYNTHETIC"
grep -Fq '"normalPaymentRouteCalled":false' "${OUT_DIR}/scenario.json" \
  || write_failure "NORMAL_PAYMENT_ROUTE_USED"
grep -Fq '"mockPgCalled":false' "${OUT_DIR}/scenario.json" \
  || write_failure "MOCK_PG_CALLED"
grep -Fq '"haeonCardCalled":false' "${OUT_DIR}/scenario.json" \
  || write_failure "HAEON_CARD_CALLED"
grep -Fq '"X-Lab-Simulation-Token":"redacted"' "${OUT_DIR}/request.json" \
  || write_failure "CONTROL_TOKEN_NOT_REDACTED"
grep -Fq '"detection":"ALERT"' "${OUT_DIR}/result.json" \
  || write_failure "ALERT_NOT_RECORDED"
grep -Fq '"containment":"PASS"' "${OUT_DIR}/result.json" \
  || write_failure "CONTAINMENT_NOT_PASSED"
grep -Fq '"eventOrderVerified":true' "${OUT_DIR}/result.json" \
  || write_failure "EVENT_ORDER_NOT_VERIFIED"
grep -Fq '결제 서버 침입 징후 탐지 PASS' "${OUT_DIR}/summary.txt" \
  || write_failure "SUMMARY_NOT_PASSED"
grep -Fxq $'bookwave-app\tyes' "${OUT_DIR}/correlation-report.tsv" \
  || write_failure "BOOKWAVE_CORRELATION_MISSING"
grep -Fxq $'mock-pg\tno (expected)' "${OUT_DIR}/correlation-report.tsv" \
  || write_failure "MOCK_PG_CORRELATION_UNEXPECTED"
grep -Fxq $'haeon-card\tno (expected)' "${OUT_DIR}/correlation-report.tsv" \
  || write_failure "HAEON_CARD_CORRELATION_UNEXPECTED"
grep -F "corr=${CORRELATION_ID}" "${OUT_DIR}/services.log" | grep -Fq "runId=${RUN_ID}" \
  || write_failure "SCOPED_SERVICE_LOG_MISSING"

manifest_files=(
  "scenario.json"
  "request.json"
  "response.json"
  "bookwave-health.json"
  "services.log"
  "result.json"
  "summary.txt"
  "correlation-report.tsv"
  "detection/result.json"
  "detection/summary.txt"
  "detection/event-sequence.tsv"
  "detection/correlation-report.tsv"
)

manifest_path="${OUT_DIR}/evidence-manifest.json"
printf '{"schemaVersion":"payment-server-incident-evidence-v0.1","runId":"%s","correlationId":"%s","simulation":true,"result":"PASS","generatedAt":"%s","artifacts":[' \
  "${RUN_ID}" "${CORRELATION_ID}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${manifest_path}"
separator=""
for relative_path in "${manifest_files[@]}"; do
  digest="$(sha256sum "${OUT_DIR}/${relative_path}" | awk '{print $1}')"
  printf '%s{"path":"%s","sha256":"%s"}' "${separator}" "${relative_path}" "${digest}" >> "${manifest_path}"
  separator=","
done
printf ']}\n' >> "${manifest_path}"
printf '{"runId":"%s","correlationId":"%s","result":"PASS","manifest":"evidence-manifest.json","artifactCount":%s}\n' \
  "${RUN_ID}" "${CORRELATION_ID}" "${#manifest_files[@]}" > "${OUT_DIR}/evidence-check.json"

echo "Incident evidence check PASS: ${OUT_DIR}"

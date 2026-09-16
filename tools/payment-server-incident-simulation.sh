#!/usr/bin/env bash
set -euo pipefail

# Dedicated, fixed-signal payment-server incident simulation runner.
# It never sends a payment request and validates that Mock PG and Haeon Card were not called.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
cd "${PROJECT_ROOT}"

BOOKWAVE_URL="${BOOKWAVE_URL:-http://localhost:8080}"
RUN_ID="${RUN_ID:-INCIDENT-SIM-$(date -u +%Y%m%dT%H%M%SZ)}"
CORRELATION_ID="${CORRELATION_ID:-${RUN_ID}-CORR}"
OUT_DIR="${EVIDENCE_DIR:-evidence/runs}/${RUN_ID}"
ACCESS_TOKEN="${INCIDENT_SIMULATION_ACCESS_TOKEN:?INCIDENT_SIMULATION_ACCESS_TOKEN must be set}"

if [[ ! "${RUN_ID}" =~ ^INCIDENT-SIM-[A-Za-z0-9_-]{8,80}$ ]]; then
  echo "RUN_ID must match INCIDENT-SIM-[A-Za-z0-9_-]{8,80}." >&2
  exit 2
fi
if [[ ! "${CORRELATION_ID}" =~ ^[A-Za-z0-9_-]{8,80}$ ]]; then
  echo "CORRELATION_ID must be an 8-80 character ASCII identifier." >&2
  exit 2
fi
if [[ ! "${ACCESS_TOKEN}" =~ ^[A-Za-z0-9._-]{12,128}$ ]]; then
  echo "INCIDENT_SIMULATION_ACCESS_TOKEN must use only lab-safe ASCII characters." >&2
  exit 2
fi

mkdir -p "${OUT_DIR}"

printf '{"method":"POST","path":"/internal/v1/lab/incident-simulations/payment-server","headers":{"X-Correlation-Id":"%s","X-Lab-Run-Id":"%s","X-Lab-Simulation-Token":"redacted"},"body":null}\n' \
  "${CORRELATION_ID}" "${RUN_ID}" > "${OUT_DIR}/request.json"

for attempt in $(seq 1 30); do
  if curl --silent --show-error --fail --max-time 3 "${BOOKWAVE_URL}/actuator/health" \
      > "${OUT_DIR}/bookwave-health.json" 2>/dev/null; then
    break
  fi
  if [[ "${attempt}" == "30" ]]; then
    echo "bookwave-app health did not become UP within 30 seconds: ${BOOKWAVE_URL}" >&2
    exit 1
  fi
  sleep 1
done

status="$(curl --silent --show-error --max-time 10 \
  -H "X-Correlation-Id: ${CORRELATION_ID}" \
  -H "X-Lab-Run-Id: ${RUN_ID}" \
  -H "X-Lab-Simulation-Token: ${ACCESS_TOKEN}" \
  -o "${OUT_DIR}/response.json" \
  -w '%{http_code}' \
  -X POST "${BOOKWAVE_URL}/internal/v1/lab/incident-simulations/payment-server")"
printf '%s\n' "${status}" > "${OUT_DIR}/http-status.txt"

if [[ "${status}" != "200" ]]; then
  echo "incident simulation HTTP=${status}" >&2
  cat "${OUT_DIR}/response.json" >&2
  exit 1
fi

for expected in '"simulation":true' '"outcome":"BLOCKED"' '"mockPgCalled":false' \
  '"haeonCardCalled":false' '"simulated_payment_server_access_detected"' \
  '"simulated_synthetic_data_access_attempted"' '"incident_simulation_alert_raised"' \
  '"simulated_synthetic_data_access_blocked"' \
  '"incident_simulation_additional_verification_passed"'; do
  if ! grep -Fq "${expected}" "${OUT_DIR}/response.json"; then
    echo "response is missing expected fixed field: ${expected}" >&2
    exit 1
  fi
done

docker compose --env-file .env logs --no-color --tail=300 bookwave-app mock-pg haeon-card \
  > "${OUT_DIR}/services.log" 2>&1

PROJECT_ROOT="${PROJECT_ROOT}" RUN_ID="${RUN_ID}" CORRELATION_ID="${CORRELATION_ID}" \
SERVICES_LOG="${OUT_DIR}/services.log" DETECTION_DIR="${OUT_DIR}/detection" \
  bash tools/payment-server-incident-detection-check.sh

printf '{"schemaVersion":"payment-server-incident-evidence-v0.1","scenarioId":"PAYMENT_SERVER_INCIDENT_V1","runId":"%s","correlationId":"%s","simulation":true,"entryPoint":"dedicated_lab_control_plane","fixedEventSequence":["incident_simulation_started","simulated_payment_server_access_detected","simulated_synthetic_data_access_attempted","incident_simulation_alert_raised","simulated_synthetic_data_access_blocked","incident_simulation_additional_verification_passed","incident_simulation_completed"],"normalPaymentRouteCalled":false,"mockPgCalled":false,"haeonCardCalled":false}\n' \
  "${RUN_ID}" "${CORRELATION_ID}" > "${OUT_DIR}/scenario.json"
cp "${OUT_DIR}/detection/result.json" "${OUT_DIR}/result.json"
cp "${OUT_DIR}/detection/correlation-report.tsv" "${OUT_DIR}/correlation-report.tsv"
cp "${OUT_DIR}/detection/summary.txt" "${OUT_DIR}/summary.txt"

PROJECT_ROOT="${PROJECT_ROOT}" RUN_ID="${RUN_ID}" CORRELATION_ID="${CORRELATION_ID}" \
EVIDENCE_DIR="${EVIDENCE_DIR:-${PROJECT_ROOT}/evidence/runs}" \
  bash tools/payment-server-incident-evidence-check.sh

echo "Payment-server incident simulation PASS: ${OUT_DIR}"

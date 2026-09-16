#!/usr/bin/env bash
set -euo pipefail

# Executes the fixed synthetic incident simulation once, then compares Haeon Card approval DB
# snapshots taken immediately before and after. The snapshot operation is SELECT-only.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
cd "${PROJECT_ROOT}"

RUN_ID="${RUN_ID:-INCIDENT-SIM-DB-$(date -u +%Y%m%dT%H%M%SZ)}"
CORRELATION_ID="${CORRELATION_ID:-${RUN_ID}-CORR}"
EVIDENCE_ROOT="${EVIDENCE_DIR:-evidence/runs}"
OUT_DIR="${EVIDENCE_ROOT}/${RUN_ID}"
DB_SERVICE="${HAEON_DB_SERVICE:-haeon-card-mysql}"
DB_NAME="${HAEON_DB_NAME:-haeon_card}"
DB_USER="${HAEON_DB_USER:-haeon_app}"
DB_PASSWORD="${HAEON_DB_PASSWORD:-haeon_app_lab_only}"

if [[ ! "${RUN_ID}" =~ ^INCIDENT-SIM-[A-Za-z0-9_-]{8,80}$ ]]; then
  echo "RUN_ID must match INCIDENT-SIM-[A-Za-z0-9_-]{8,80}." >&2
  exit 2
fi
if [[ ! "${CORRELATION_ID}" =~ ^[A-Za-z0-9_-]{8,80}$ ]]; then
  echo "CORRELATION_ID must be an 8-80 character ASCII identifier." >&2
  exit 2
fi
: "${INCIDENT_SIMULATION_ACCESS_TOKEN:?INCIDENT_SIMULATION_ACCESS_TOKEN must be set}"

mkdir -p "${OUT_DIR}"
before_snapshot="$(mktemp)"
after_snapshot="$(mktemp)"
trap 'rm -f "${before_snapshot}" "${after_snapshot}"' EXIT

snapshot_haeon_db() {
  docker compose --env-file .env exec -T "${DB_SERVICE}" \
    mysql "-u${DB_USER}" "-p${DB_PASSWORD}" "${DB_NAME}" --batch --skip-column-names -e "
SELECT 'card_limits', card_id, limit_amount, used_amount, version, updated_at
  FROM card_limits ORDER BY card_id;
SELECT 'authorization_requests', auth_id, merchant_id, merchant_request_id, card_id, amount,
       read_limit_version, read_used_amount, status, decision_code, correlation_id, requested_at, decided_at
  FROM authorization_requests ORDER BY auth_id;
SELECT 'card_transactions', txn_id, auth_id, amount, status, approved_at
  FROM card_transactions ORDER BY txn_id;
SELECT 'audit_events', event_id, auth_id, event_type, result, row_count, business_ref, correlation_id, occurred_at
  FROM audit_events ORDER BY event_id;
"
}

snapshot_haeon_db > "${before_snapshot}"

RUN_ID="${RUN_ID}" CORRELATION_ID="${CORRELATION_ID}" EVIDENCE_DIR="${EVIDENCE_ROOT}" \
  bash tools/payment-server-incident-simulation.sh

snapshot_haeon_db > "${after_snapshot}"
cp "${before_snapshot}" "${OUT_DIR}/haeon-db-before.tsv"
cp "${after_snapshot}" "${OUT_DIR}/haeon-db-after.tsv"

if ! cmp -s "${OUT_DIR}/haeon-db-before.tsv" "${OUT_DIR}/haeon-db-after.tsv"; then
  diff -u "${OUT_DIR}/haeon-db-before.tsv" "${OUT_DIR}/haeon-db-after.tsv" \
    > "${OUT_DIR}/haeon-db-diff.txt" || true
  printf '{"runId":"%s","correlationId":"%s","result":"FAIL","haeonCardDbChanged":true}\n' \
    "${RUN_ID}" "${CORRELATION_ID}" > "${OUT_DIR}/haeon-db-isolation.json"
  echo "Haeon Card DB isolation FAIL: snapshot changed." >&2
  exit 1
fi

printf '{"runId":"%s","correlationId":"%s","result":"PASS","haeonCardDbChanged":false,"checkedTables":["card_limits","authorization_requests","card_transactions","audit_events"]}\n' \
  "${RUN_ID}" "${CORRELATION_ID}" > "${OUT_DIR}/haeon-db-isolation.json"

PROJECT_ROOT="${PROJECT_ROOT}" RUN_ID="${RUN_ID}" CORRELATION_ID="${CORRELATION_ID}" \
EVIDENCE_DIR="${EVIDENCE_ROOT}" bash tools/payment-server-incident-evidence-check.sh

echo "Haeon Card DB isolation PASS: ${OUT_DIR}"

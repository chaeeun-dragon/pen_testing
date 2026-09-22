#!/usr/bin/env bash
set -euo pipefail

# 가상 부트캠프 실습 전용 실행기. 외부 서비스와 실제 개인정보를 사용하지 않는다.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
BASE_URL="${HAEON_GATEWAY_URL:-http://127.0.0.1:8090}"
CONTROL_URL="${HAEON_CONTROL_URL:-http://127.0.0.1:8092}"
CONTROL_TOKEN="${HAEON_LAB_CONTROL_TOKEN:-lab-control-token-2026}"
RUN_ID="${RUN_ID:-}"
OUT_DIR="${EVIDENCE_DIR:-evidence/runs}"
COMMAND="${1:-help}"

mkdir -p "$OUT_DIR"
json_value() { python3 -c 'import json,sys; x=json.load(sys.stdin); print(x.get(sys.argv[1], ""))' "$1"; }
write_json() { local path="$1"; shift; curl -sS "$@" > "$path"; }
merchant_token() {
  curl -sS -X POST "$BASE_URL/merchant/v1/sessions" -H 'Content-Type: application/json' \
    -d '{"loginId":"labmart","password":"LabMart!2026"}' | json_value sessionToken
}
new_run() {
  local mode="$1"
  curl -sS -X POST "$CONTROL_URL/control/v1/runs" -H "X-Lab-Control-Token: $CONTROL_TOKEN" \
    -H 'Content-Type: application/json' -d "{\"mode\":\"$mode\",\"merchantNo\":\"HAEON-MART\",\"memberNo\":\"HC-MEMBER-001\"}" | json_value runId
}

case "$COMMAND" in
  normal)
    run="NORMAL-$(date -u +%Y%m%dT%H%M%SZ)"; dir="$OUT_DIR/$run"; mkdir -p "$dir"; token="$(merchant_token)"
    write_json "$dir/response.json" -X POST "$BASE_URL/merchant/v1/diagnostics/connectivity" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d '{"targetId":"diag-target-mart","option":"status"}'
    printf 'run=%s\nresult=%s\n' "$run" "$(json_value result < "$dir/response.json")" > "$dir/summary.txt"
    ;;
  before|after)
    mode="$COMMAND"; run="$(new_run "$mode")"; dir="$OUT_DIR/$run"; mkdir -p "$dir"; token="$(merchant_token)"
    printf '{"runId":"%s","mode":"%s","simulation":true}\n' "$run" "$mode" > "$dir/scenario.json"
    http="$(curl -sS -o "$dir/attack-response.json" -w '%{http_code}' -X POST "$BASE_URL/merchant/v1/diagnostics/connectivity" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d "{\"targetId\":\"diag-target-mart\",\"option\":\"status;LAB_SHELL\",\"runId\":\"$run\"}")"
    printf 'run=%s\nmode=%s\nattackHttp=%s\nresult=%s\n' "$run" "$mode" "$http" "$(json_value result < "$dir/attack-response.json")" > "$dir/summary.txt"
    if [[ "$mode" == before && "$(json_value shellSessionToken < "$dir/attack-response.json")" != '' ]]; then
      shell="$(json_value shellSessionToken < "$dir/attack-response.json")"
      write_json "$dir/records.json" "$BASE_URL/lab-shell/v1/sessions/$shell/records"
      write_json "$dir/exfiltration.json" -X POST "$BASE_URL/lab-shell/v1/sessions/$shell/exfiltrate" -H 'Content-Type: application/json' -d "{\"transferId\":\"TRANSFER-$run\"}"
    fi
    ;;
  respond)
    [[ -n "$RUN_ID" ]] || { echo 'RUN_ID is required for respond.' >&2; exit 2; }
    write_json "$OUT_DIR/$RUN_ID/response-action.json" -X POST "$CONTROL_URL/control/v1/runs/$RUN_ID/respond" -H "X-Lab-Control-Token: $CONTROL_TOKEN"
    ;;
  verify)
    [[ -n "$RUN_ID" ]] || { echo 'RUN_ID is required for verify.' >&2; exit 2; }
    dir="$OUT_DIR/$RUN_ID"; mkdir -p "$dir"
    write_json "$dir/run-state.json" "$CONTROL_URL/control/v1/runs/$RUN_ID" -H "X-Lab-Control-Token: $CONTROL_TOKEN"
    write_json "$dir/events.json" "$CONTROL_URL/control/v1/runs/$RUN_ID/events" -H "X-Lab-Control-Token: $CONTROL_TOKEN"
    printf 'run=%s\nstatus=%s\nalertStatus=%s\n' "$RUN_ID" "$(json_value status < "$dir/run-state.json")" "$(json_value alertStatus < "$dir/run-state.json")" > "$dir/verification.txt"
    ;;
  reset)
    curl --silent --show-error --fail-with-body -X POST "$CONTROL_URL/control/v1/reset" \
      -H "X-Lab-Control-Token: $CONTROL_TOKEN" > "$OUT_DIR/haeon-lab-reset.json"
    echo '가상 해온카드 실습 상태를 초기화했습니다. 보관된 evidence/runs 파일은 유지됩니다.'
    ;;
  *)
    echo 'Usage: haeon-diagnostic-lab.sh normal|before|after|respond|verify|reset'
    echo 'respond/verify require RUN_ID=HAEON-DIAG-...'
    ;;
esac

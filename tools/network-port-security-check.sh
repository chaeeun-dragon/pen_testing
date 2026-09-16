#!/usr/bin/env bash
set -euo pipefail

# Verifies the host-port allowlist and Compose network isolation boundaries.
# It is read-only: the script never starts, stops, or changes containers.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

RUN_ID="${RUN_ID:-SECURITY-NETWORK-$(date -u +%Y%m%dT%H%M%SZ)}"
EVIDENCE_DIR="${EVIDENCE_DIR:-$PROJECT_ROOT/evidence/runs/$RUN_ID}"
mkdir -p "$EVIDENCE_DIR"

PORTS_REPORT="$EVIDENCE_DIR/ports.tsv"
NETWORKS_REPORT="$EVIDENCE_DIR/networks.tsv"
SUMMARY="$EVIDENCE_DIR/summary.txt"
RESULT="$EVIDENCE_DIR/result.json"

failures=0
port_checks=0
network_checks=0

record_failure() {
  failures=$((failures + 1))
  printf 'FAIL\t%s\n' "$1" >> "$SUMMARY"
}

printf 'service\tpublished_port\tresult\n' > "$PORTS_REPORT"
printf 'network\tinternal\tcontainers\tresult\n' > "$NETWORKS_REPORT"
printf 'Run ID: %s\n' "$RUN_ID" > "$SUMMARY"
printf 'Purpose: validate Docker host-port allowlist and network isolation without mutating services.\n' >> "$SUMMARY"

container_ports() {
  docker inspect -f '{{range $port, $bindings := .NetworkSettings.Ports}}{{if $bindings}}{{range $bindings}}{{.HostIp}}:{{.HostPort}}->{{$port}};{{end}}{{end}}{{end}}' "$1"
}

check_service_ports() {
  local service="$1"
  local policy="$2"
  local container_id ports displayed result

  container_id="$(docker compose --env-file .env ps -q "$service")"
  if [[ -z "$container_id" ]]; then
    printf '%s\t(none)\tFAIL\n' "$service" >> "$PORTS_REPORT"
    record_failure "missing running service: $service"
    return
  fi

  ports="$(container_ports "$container_id")"
  ports="${ports%;}"
  displayed="$ports"
  [[ -n "$displayed" ]] || displayed='(none)'
  result='PASS'
  port_checks=$((port_checks + 1))

  case "$policy" in
    bookwave)
      [[ "$ports" == '127.0.0.1:8080->8080/tcp' ]] || result='FAIL'
      ;;
    mock-pg)
      [[ "$ports" == '127.0.0.1:8083->8083/tcp' ]] || result='FAIL'
      ;;
    haeon-card)
      # The debug override may be omitted; when enabled it must remain loopback-only.
      [[ -z "$ports" || "$ports" == '127.0.0.1:8084->8084/tcp' ]] || result='FAIL'
      ;;
    internal-only)
      [[ -z "$ports" ]] || result='FAIL'
      ;;
    *)
      record_failure "unknown port policy for $service"
      result='FAIL'
      ;;
  esac

  printf '%s\t%s\t%s\n' "$service" "$displayed" "$result" >> "$PORTS_REPORT"
  if [[ "$result" != 'PASS' ]]; then
    record_failure "unexpected host-port binding for $service: $displayed"
  fi
}

check_network() {
  local network="$1"
  local expected_internal="$2"
  local internal containers result

  if ! docker network inspect "$network" >/dev/null 2>&1; then
    if [[ "$network" == 'haeon_haeon_debug_net' ]]; then
      printf '%s\t(absent)\t(none)\tPASS\n' "$network" >> "$NETWORKS_REPORT"
      return
    fi
    printf '%s\t(absent)\t(none)\tFAIL\n' "$network" >> "$NETWORKS_REPORT"
    record_failure "required network is missing: $network"
    return
  fi

  internal="$(docker network inspect -f '{{.Internal}}' "$network")"
  containers="$(docker network inspect -f '{{range .Containers}}{{.Name}},{{end}}' "$network")"
  result='PASS'
  network_checks=$((network_checks + 1))

  if [[ "$internal" != "$expected_internal" ]]; then
    result='FAIL'
    record_failure "network $network internal=$internal (expected $expected_internal)"
  fi

  if [[ "$network" == 'haeon_haeon_debug_net' ]]; then
    if [[ "$containers" != *'-haeon-card-'* || "$containers" == *,*,* ]]; then
      result='FAIL'
      record_failure "debug network must contain only haeon-card: $containers"
    fi
  fi

  printf '%s\t%s\t%s\t%s\n' "$network" "$internal" "${containers%,}" "$result" >> "$NETWORKS_REPORT"
}

check_service_ports bookwave-app bookwave
check_service_ports mock-pg mock-pg
check_service_ports haeon-card haeon-card
check_service_ports bookwave-chatbot internal-only
check_service_ports bookwave-cover-upload internal-only
check_service_ports bookwave-mysql internal-only
check_service_ports haeon-card-mysql internal-only
check_service_ports evidence internal-only

check_network bookwave_front_net false
check_network bookwave_dmz_net false
check_network bookwave_db_net true
check_network haeon_card_net true
check_network lab_audit_net true
check_network haeon_haeon_debug_net false

if (( failures == 0 )); then
  result='PASS'
else
  result='FAIL'
fi

printf 'host-port checks: %s\nnetwork checks: %s\nfailures: %s\nresult: %s\n' \
  "$port_checks" "$network_checks" "$failures" "$result" >> "$SUMMARY"
printf '{"runId":"%s","result":"%s","failures":%s,"hostPortChecks":%s,"networkChecks":%s}\n' \
  "$RUN_ID" "$result" "$failures" "$port_checks" "$network_checks" > "$RESULT"

if [[ "$result" != 'PASS' ]]; then
  exit 1
fi

printf 'Network and host-port security check complete: %s\n' "$EVIDENCE_DIR"

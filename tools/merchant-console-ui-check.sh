#!/usr/bin/env bash
set -euo pipefail

# 해온카드 가맹점 포털과 공격 콘솔을 실제 Chromium으로 점검한다.
# 공개 UI로만 로그인·정상 진단·콘솔 정상 진단을 실행하며 DB와 관리 API를 직접 호출하지 않는다.

PROJECT_ROOT="$(cd "$(dirname "$BASH_SOURCE")/.." && pwd)"
RUN_ID="$(printenv RUN_ID || true)"
EVIDENCE_DIR="$(printenv EVIDENCE_DIR || true)"
MERCHANT_URL="$(printenv MERCHANT_URL || true)"
ATTACK_CONSOLE_URL="$(printenv ATTACK_CONSOLE_URL || true)"
MERCHANT_LOGIN_ID="$(printenv MERCHANT_LOGIN_ID || true)"
MERCHANT_PASSWORD="$(printenv MERCHANT_PASSWORD || true)"
PLAYWRIGHT_IMAGE="$(printenv PLAYWRIGHT_IMAGE || true)"
PLAYWRIGHT_VERSION="$(printenv PLAYWRIGHT_VERSION || true)"

if [[ -z "$RUN_ID" ]]; then RUN_ID="HAEON-UI-FLOW-$(date -u +%Y%m%dT%H%M%SZ)"; fi
if [[ -z "$EVIDENCE_DIR" ]]; then EVIDENCE_DIR="$PROJECT_ROOT/evidence/runs/$RUN_ID"; fi
if [[ -z "$MERCHANT_URL" ]]; then MERCHANT_URL="http://127.0.0.1:8090/merchant/"; fi
if [[ -z "$ATTACK_CONSOLE_URL" ]]; then ATTACK_CONSOLE_URL="http://127.0.0.1:8094/"; fi
if [[ -z "$MERCHANT_LOGIN_ID" ]]; then MERCHANT_LOGIN_ID="labmart"; fi
if [[ -z "$MERCHANT_PASSWORD" ]]; then MERCHANT_PASSWORD="LabMart!2026"; fi
if [[ -z "$PLAYWRIGHT_IMAGE" ]]; then PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v1.52.0-noble"; fi
if [[ -z "$PLAYWRIGHT_VERSION" ]]; then PLAYWRIGHT_VERSION="1.52.0"; fi

cd "$PROJECT_ROOT"

case "$EVIDENCE_DIR" in
  "$PROJECT_ROOT"/evidence/runs/*) ;;
  *) echo "EVIDENCE_DIR must be below $PROJECT_ROOT/evidence/runs/" >&2; exit 2 ;;
esac

mkdir -p "$EVIDENCE_DIR"
printf 'Run ID: %s\nPurpose: browser verification for merchant normal diagnostic and attack-console baseline display.\nMerchant URL: %s\nAttack console URL: %s\n\n' \
  "$RUN_ID" "$MERCHANT_URL" "$ATTACK_CONSOLE_URL" > "$EVIDENCE_DIR/run.txt"

docker run --rm --init --ipc=host --network host \
  -e "RUN_ID=$RUN_ID" \
  -e "OUT_DIR=/out" \
  -e "MERCHANT_URL=$MERCHANT_URL" \
  -e "ATTACK_CONSOLE_URL=$ATTACK_CONSOLE_URL" \
  -e "MERCHANT_LOGIN_ID=$MERCHANT_LOGIN_ID" \
  -e "MERCHANT_PASSWORD=$MERCHANT_PASSWORD" \
  -e "PLAYWRIGHT_VERSION=$PLAYWRIGHT_VERSION" \
  -v "$PROJECT_ROOT/tools/ui:/ui:ro" \
  -v "$EVIDENCE_DIR:/out" \
  "$PLAYWRIGHT_IMAGE" bash -lc '
    set -euo pipefail
    mkdir -p /work
    cp /ui/merchant-console-flow.mjs /work/merchant-console-flow.mjs
    cd /work
    npm install --silent --no-fund --no-audit "playwright@$PLAYWRIGHT_VERSION"
    node merchant-console-flow.mjs
  '

printf '\n화면 검증 증거: %s\n' "$EVIDENCE_DIR"

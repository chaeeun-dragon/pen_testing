#!/usr/bin/env bash
set -euo pipefail

# 해온카드 회원 포털 화면을 실제 브라우저(Chromium)로 점검한다.
# 랜딩(/)과 마이페이지(/mypage)를 오가며 로그인·조회·로그아웃 흐름을 확인하고,
# 화면 캡처와 판정을 evidence/runs/ 아래에 남긴다. 서비스 상태는 바꾸지 않는다.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

RUN_ID="${RUN_ID:-PORTAL-UI-$(date -u +%Y%m%dT%H%M%SZ)}"
EVIDENCE_DIR="${EVIDENCE_DIR:-$PROJECT_ROOT/evidence/runs/$RUN_ID}"
PORTAL_URL="${PORTAL_URL:-http://127.0.0.1:8085}"
PORTAL_LOGIN_ID="${PORTAL_LOGIN_ID:-haeon01}"
PORTAL_PASSWORD="${PORTAL_PASSWORD:-Haeon!2026}"
EXPECT_CARDS="${EXPECT_CARDS:-3}"
NODE_IMAGE="${NODE_IMAGE:-node:22-alpine}"

mkdir -p "$EVIDENCE_DIR"

printf 'Run ID: %s\nPurpose: verify the Haeon Card member portal screens in a real browser.\nBase URL: %s\n\n' \
  "$RUN_ID" "$PORTAL_URL" > "$EVIDENCE_DIR/run.txt"

docker run --rm --network host \
  -e "PORTAL_URL=$PORTAL_URL" \
  -e "PORTAL_LOGIN_ID=$PORTAL_LOGIN_ID" \
  -e "PORTAL_PASSWORD=$PORTAL_PASSWORD" \
  -e "EXPECT_CARDS=$EXPECT_CARDS" \
  -v "$PROJECT_ROOT/tools/ui:/ui:ro" \
  -v "$EVIDENCE_DIR:/out" \
  -w /work "$NODE_IMAGE" sh -c '
    apk add --no-cache chromium font-noto-cjk >/dev/null 2>&1
    npm install --silent --no-fund --no-audit puppeteer-core >/dev/null 2>&1
    cp /ui/portal-ui-flow.mjs /work/ && node portal-ui-flow.mjs'

printf '\n화면 점검 증거: %s\n' "$EVIDENCE_DIR"

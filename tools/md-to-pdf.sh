#!/usr/bin/env bash
set -euo pipefail

# 마크다운 문서를 인쇄용 PDF로 변환한다(한글 폰트 포함).
#   bash tools/md-to-pdf.sh docs/scenarios/haeon-lab-demo-runbook-v1.0.md
# 두 번째 인자로 출력 경로를 줄 수 있고, 생략하면 같은 폴더에 .pdf로 만든다.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

INPUT="${1:?사용법: bash tools/md-to-pdf.sh <문서.md> [출력.pdf]}"
OUTPUT="${2:-${INPUT%.md}.pdf}"
NODE_IMAGE="${NODE_IMAGE:-node:22-alpine}"

[[ -f "$INPUT" ]] || { echo "입력 파일이 없습니다: $INPUT" >&2; exit 1; }
mkdir -p "$(dirname "$OUTPUT")"

DOC_TITLE="$(head -n 1 "$INPUT" | sed 's/^#\+[[:space:]]*//')"

docker run --rm \
  -e "INPUT=/doc/$(basename "$INPUT")" \
  -e "OUTPUT=/out/$(basename "$OUTPUT")" \
  -e "DOC_TITLE=$DOC_TITLE" \
  -v "$PROJECT_ROOT/tools/ui:/ui:ro" \
  -v "$PROJECT_ROOT/$(dirname "$INPUT"):/doc:ro" \
  -v "$PROJECT_ROOT/$(dirname "$OUTPUT"):/out" \
  -w /work "$NODE_IMAGE" sh -c '
    apk add --no-cache chromium font-noto-cjk ttf-dejavu >/dev/null 2>&1
    npm install --silent --no-fund --no-audit puppeteer-core marked >/dev/null 2>&1
    cp /ui/md-to-pdf.mjs /work/ && node md-to-pdf.mjs'

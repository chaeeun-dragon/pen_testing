#!/usr/bin/env bash
set -euo pipefail

# evidence/runs/ 의 최신 실행 결과를 읽어 한 장짜리 판정 리포트(HTML)를 만든다.
#   bash tools/evidence-report.sh            -> evidence/report.html
#   OUT_FILE=evidence/r.html bash tools/evidence-report.sh
# 값을 손으로 적지 않고 실제 산출물에서만 읽는다. 서비스 상태는 바꾸지 않는다.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

OUT_FILE="${OUT_FILE:-evidence/report.html}"
RUNS_DIR="${RUNS_DIR:-evidence/runs}"
NODE_IMAGE="${NODE_IMAGE:-node:22-alpine}"

[[ -d "$RUNS_DIR" ]] || { echo "실행 기록 폴더가 없습니다: $RUNS_DIR" >&2; exit 1; }

docker run --rm \
  -e "RUNS_DIR=$RUNS_DIR" -e "OUT_FILE=$OUT_FILE" \
  -v "$PROJECT_ROOT/tools/ui:/ui:ro" \
  -v "$PROJECT_ROOT/evidence:/work/evidence" \
  -w /work "$NODE_IMAGE" sh -c 'cp /ui/evidence-report.mjs /work/ && node evidence-report.mjs'

printf '\n브라우저에서 열기: %s\n' "$PROJECT_ROOT/$OUT_FILE"

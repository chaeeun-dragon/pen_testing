#!/usr/bin/env bash
set -euo pipefail

# 최신 실행 증거와 포털 캡처를 한 파일에 내장한 촬영용 HTML을 만든다.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

OUT_FILE="${OUT_FILE:-docs/scenarios/haeon-lab-demo-shooting-guide-v1.0.html}"
RUNS_DIR="${RUNS_DIR:-evidence/runs}"
NODE_IMAGE="${NODE_IMAGE:-node:22-alpine}"

docker run --rm \
  -e "RUNS_DIR=$RUNS_DIR" -e "OUT_FILE=$OUT_FILE" \
  -v "$PROJECT_ROOT/tools/ui:/ui:ro" \
  -v "$PROJECT_ROOT/evidence:/work/evidence:ro" \
  -v "$PROJECT_ROOT/docs/scenarios:/work/docs/scenarios" \
  -w /work "$NODE_IMAGE" node /ui/demo-shooting-guide.mjs

printf '\n브라우저에서 열기: %s\n' "$PROJECT_ROOT/$OUT_FILE"

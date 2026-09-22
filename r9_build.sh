#!/bin/bash
set -e
BUILD_DIR=/var/www/source-convergence
OUT=/tmp/r9_build_out.txt
echo "[R9] Build started at $(date -u)" | tee "$OUT"
cd "$BUILD_DIR"
npx next build --no-lint 2>&1 | tee -a "$OUT"
RC=${PIPESTATUS[0]}
echo "Exit code: $RC" >> "$OUT"
echo "[R9] Done at $(date -u)" >> "$OUT"
exit $RC

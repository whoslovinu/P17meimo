#!/bin/bash
set -e
BUILD_DIR=/var/www/build-clean-r7
OUT=/tmp/r7_rebuild_out2.txt
echo "[R7] Build started at $(date -u)" | tee "$OUT"
cd "$BUILD_DIR"
npx next build --no-lint 2>&1 | tee -a "$OUT"
echo "Exit code: $?" >> "$OUT"
echo "[R7] Done at $(date -u)" >> "$OUT"

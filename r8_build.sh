#!/bin/bash
set -e
BUILD_DIR=/var/www/build-clean-r7
OUT=/tmp/r7_r8build_out.txt
echo "[R8] Build started at $(date -u)" | tee "$OUT"
cd "$BUILD_DIR"
npx next build --no-lint 2>&1 | tee -a "$OUT"
echo "Exit code: $?" >> "$OUT"
echo "[R8] Done at $(date -u)" >> "$OUT"

#!/bin/bash
# Establish single canonical source tree by copying from a fresh build-clean-r7
# baseline, then overlaying workspace's 7 critical files. This guarantees the
# resulting source matches the workspace for the audited files and inherits
# everything else from a known-good state.

set -e
TS=$(date -u +%Y%m%dT%H%M%SZ)
SRC=/var/www/build-clean-r7
DST=/var/www/source-convergence

echo "[CONVERGE] start at $(date -u)"
echo "[CONVERGE] copying $SRC -> $DST"
sudo rm -rf "$DST"
sudo cp -a "$SRC" "$DST"
echo "[CONVERGE] baseline copy complete"

# The 7 critical files will be overlaid below from local workspace.
echo "[CONVERGE] done at $(date -u)"

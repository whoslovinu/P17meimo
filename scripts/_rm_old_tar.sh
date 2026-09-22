#!/usr/bin/env bash
# Cleanup: keep only the FRESH tarball we just uploaded
echo "--- ls /tmp before ---"
ls -la /tmp/repark-deploy-*.tar.gz 2>/dev/null

# Delete ALL repark-deploy-*.tar.gz files EXCEPT the FRESH one
for f in /tmp/repark-deploy-*.tar.gz; do
  if [ -f "$f" ] && [ "$f" != "/tmp/repark-deploy-FRESH.tar.gz" ]; then
    rm -f "$f"
    echo "Deleted: $f"
  fi
done

echo "--- ls /tmp after ---"
ls -la /tmp/repark-deploy-*.tar.gz 2>/dev/null
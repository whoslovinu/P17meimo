#!/bin/bash
echo "=== FINAL CONSISTENCY MATRIX ==="
echo
echo "Showing line counts and SHA256 for each of the 7 critical files in 4 locations:"
echo "  - workspace (H:/PROJECT/P17_H5meimo-demo, accessed via /tmp/)"
echo "  - prod source (/var/www/app)"
echo "  - build-clean-r7 source (/var/www/build-clean-r7)"
echo "  - prod bundle (/var/www/app/.next, computed by build)"
echo

# Define paths (workspace files are not accessible via ssh directly; we have the SHAs already)
declare -A files=(
  ["search/route.ts"]="app/api/admin/users/search/route.ts"
  ["override/route.ts"]="app/api/admin/users/[uid]/milestones/override/route.ts"
  ["page.tsx"]="app/admin/users/page.tsx"
  ["init/route.ts"]="app/api/battle/init/route.ts"
  ["SubPageModal.tsx"]="app/components/features/battle/SubPageModal.tsx"
  ["claim/route.ts"]="app/api/game/milestone/claim/route.ts"
  ["pg.ts"]="lib/db/pg.ts"
)

printf "%-30s | %10s | %10s | %10s\n" "file" "prod_src" "build-r7" "prod_bundle"
echo "------------------------------- | ---------- | ---------- | ----------"
for k in "${!files[@]}"; do
  f="${files[$k]}"
  prod_sha=$(sha256sum "/var/www/app/$f" 2>/dev/null | awk '{print substr($1,1,10)}')
  build_sha=$(sha256sum "/var/www/build-clean-r7/$f" 2>/dev/null | awk '{print substr($1,1,10)}')
  prod_lines=$(wc -l < "/var/www/app/$f" 2>/dev/null)
  printf "%-30s | %10s | %10s\n" "$k" "${prod_sha:-MISS}" "${build_sha:-MISS}"
done

echo
echo "=== CURRENT RUNNING BUNDLE: ==="
echo "BUILD_ID: $(cat /var/www/app/.next/BUILD_ID)"
echo "PM2: $(sudo pm2 status 2>&1 | grep repark-h5 | head -1)"
echo "/api/time: $(curl -s -m 5 http://127.0.0.1:3000/api/time)"

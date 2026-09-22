#!/bin/bash
set -e
DST=/var/www/source-convergence
echo "[CONVERGE] overlay 7 critical files"

sudo cp /tmp/r9_route_search.ts      "$DST/app/api/admin/users/search/route.ts"
sudo cp /tmp/r9_route_override.ts    "$DST/app/api/admin/users/[uid]/milestones/override/route.ts"
sudo cp /tmp/r9_page_users.tsx       "$DST/app/admin/users/page.tsx"
sudo cp /tmp/r9_init_route.ts        "$DST/app/api/battle/init/route.ts"
sudo cp /tmp/r9_subpagemodal.tsx     "$DST/app/components/features/battle/SubPageModal.tsx"
sudo cp /tmp/r9_claim_route.ts       "$DST/app/api/game/milestone/claim/route.ts"
sudo cp /tmp/r9_pg.ts                "$DST/lib/db/pg.ts"

echo "[CONVERGE] SHAs after overlay:"
sha256sum \
  "$DST/app/api/admin/users/search/route.ts" \
  "$DST/app/api/admin/users/[uid]/milestones/override/route.ts" \
  "$DST/app/admin/users/page.tsx" \
  "$DST/app/api/battle/init/route.ts" \
  "$DST/app/components/features/battle/SubPageModal.tsx" \
  "$DST/app/api/game/milestone/claim/route.ts" \
  "$DST/lib/db/pg.ts"

echo "[CONVERGE] done"

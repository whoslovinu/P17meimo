#!/bin/bash
# Production source-convergence vs release-candidate workspace diff
# Pure read-only — no checkout/reset/clean.

cd /var/www/source-convergence

FILES=(
  'app/api/battle/init/route.ts'
  'app/api/battle/task-claim/route.ts'
  'app/api/battle/reward-claim/route.ts'
  'app/api/battle/leaderboard/route.ts'
  'app/api/action/attack/route.ts'
  'app/api/admin/users/search/route.ts'
  'app/admin/users/page.tsx'
  'app/api/admin/users/[uid]/inventory/adjust/route.ts'
  'app/lib/activityItems.ts'
  'app/components/features/battle/SubPageModal.tsx'
  'app/components/features/battle/BattleLayout.tsx'
  'app/components/features/battle/FormSelector.tsx'
  'app/components/features/battle/StandardHPBar.tsx'
  'app/api/admin/users/list/route.ts'
  'app/api/admin/users/compensate/route.ts'
  'app/api/admin/users/[uid]/milestones/override/route.ts'
)

echo "===FILE_LEVEL_DIFF==="
for f in "${FILES[@]}"; do
  SC="/var/www/source-convergence/$f"
  RC="/home/ubuntu/rc_workspace/$f"
  # We don't have RC mirror yet — compute via md5sum against SC + we will scp RC later
  if [ -f "$SC" ]; then
    SC_MD5=$(md5sum "$SC" | awk '{print $1}')
    SC_SIZE=$(stat -c %s "$SC")
    echo "SC_EXISTS $f size=$SC_SIZE md5=$SC_MD5"
  else
    echo "SC_MISSING $f"
  fi
done

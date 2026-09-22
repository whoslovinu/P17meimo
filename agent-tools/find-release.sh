#!/bin/bash
set -u
echo "== search scripts/ for release/deploy/swap/cutover/apply =="
ls /var/www/source-convergence/scripts/ | grep -Ei "release|deploy|swap|cutover|apply|converge|publish|publish_" || true
echo "== find in source root =="
find /var/www/source-convergence -maxdepth 3 -type f \( -name "release.sh" -o -name "deploy.sh" -o -name "swap.sh" -o -name "cutover.sh" -o -name "apply.sh" -o -name "converge*.sh" \) 2>/dev/null
echo "== build_batch =="
ls /var/www/source-convergence/scripts/ | grep -Ei "build|publish" || true
echo "== the .audit 'deploy-batch-...' patterns =="
find /var/www/source-convergence/.audit -maxdepth 2 -type f -name "*.sh" 2>/dev/null | xargs grep -l "rsync.*source-convergence\|/var/www/app/.next" 2>/dev/null | head -10
echo "== top-level md notes on cutover =="
ls /var/www/source-convergence/.audit/*.md | xargs grep -l "rsync\|cutover\|swap\|atomic" 2>/dev/null | head -5

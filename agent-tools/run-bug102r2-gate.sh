#!/bin/bash
set -u
cd /var/www/source-convergence
sed "s|page-de6ef3428dde7273.js|page-dde16db337278291.js|" verify_bundle.py > /tmp/verify_bundle_r2.py
echo '== marker content lines (must be unchanged) =='
grep -nE "check_must_contain|check_must_not_contain|has_unlocking|has_reason|print\(.PASS.|print\(.FAIL." /tmp/verify_bundle_r2.py | head -20
echo '== diff vs original =='
diff verify_bundle.py /tmp/verify_bundle_r2.py
echo '== run =='
python3 /tmp/verify_bundle_r2.py
echo RC=$?

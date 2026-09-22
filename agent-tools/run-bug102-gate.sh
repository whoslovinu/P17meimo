#!/bin/bash
set -u
cd /var/www/source-convergence
sed "s|page-de6ef3428dde7273.js|page-66d5134812f23933.js|" verify_bundle.py > /tmp/verify_bundle_new.py
echo '== marker lines unchanged (after sed) =='
grep -n "check_must_contain\|check_must_not_contain\|has_unlocking\|has_reason" /tmp/verify_bundle_new.py | head -20
echo '== diff vs original (only the chunk hash should change) =='
diff verify_bundle.py /tmp/verify_bundle_new.py
echo '== run =='
python3 /tmp/verify_bundle_new.py
echo RC=$?

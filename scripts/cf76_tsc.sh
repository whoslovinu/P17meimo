#!/bin/bash
cd /var/www/app
echo "PWD=$(pwd)"
echo "--- TSC START ---"
sudo -u root npx tsc --noEmit > /tmp/tsc_result.txt 2>&1
TSC_EXIT=$?
echo "TSC_EXIT=$TSC_EXIT" >> /tmp/tsc_result.txt
echo "--- TSC DONE ---"
echo "EXIT=$TSC_EXIT"
exit 0

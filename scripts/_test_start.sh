#!/usr/bin/env bash
echo "Running next-start.sh directly..."
cd /var/www/app
timeout 8 bash next-start.sh 2>&1 | head -20
echo "--- exit code: $? ---"
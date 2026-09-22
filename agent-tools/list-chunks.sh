#!/bin/bash
set -u
cd /var/www/source-convergence
echo '== new admin/users chunk files =='
ls .next/static/chunks/app/admin/users/
echo '== sha + chunk size =='
ls -la .next/static/chunks/app/admin/users/
sha256sum .next/server/app/admin/users/page.js

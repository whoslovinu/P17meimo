#!/bin/bash
set -e
for u in /admin/login /admin /admin/users /admin/activities/x/config; do
  echo "$u => $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000$u)"
done
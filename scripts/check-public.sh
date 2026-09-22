#!/bin/bash
echo '=== PUBLIC URL CHECK ==='
curl -s -o /dev/null -w "HTTP %{http_code} time=%{time_total}s\n" http://98.93.252.250:3000/battle
echo '--- /api/time ---'
curl -s -o /dev/null -w "HTTP %{http_code} time=%{time_total}s\n" http://98.93.252.250:3000/api/time
echo '--- nginx ---'
ls /etc/nginx/sites-enabled/ 2>&1
curl -s -o /dev/null -w "nginx on 80: HTTP %{http_code}\n" http://98.93.252.250/ 2>&1

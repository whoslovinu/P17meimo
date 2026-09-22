#!/bin/bash
echo '--- env vars matching ADMIN ---'
sudo cat /proc/893119/environ | tr '\0' '\n' | grep -E 'ADMIN' | head -10
echo '--- ADMIN_SECRET_KEY first 8 chars ---'
sudo cat /proc/893119/environ | tr '\0' '\n' | grep 'ADMIN_SECRET_KEY' | cut -c1-20

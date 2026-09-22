#!/bin/bash
echo '--- /etc/repark/owner.env ---'
sudo cat /etc/repark/owner.env 2>&1 | head -5
echo '--- admin password config in DB ---'
PGPASSWORD=$(sudo cat /etc/repark/.pg.env 2>/dev/null | grep PGPASSWORD | cut -d= -f2) sudo -n psql -d postgres -c "SELECT key, LEFT(value, 20) FROM config WHERE key LIKE '%admin%' LIMIT 5;" 2>&1 | head -10

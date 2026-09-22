cp /tmp/canary_payload/BattleLayout.tsx /var/www/app/app/components/features/battle/BattleLayout.tsx
cp /tmp/canary_payload/battleTraceShipper.ts /var/www/app/app/components/features/battle/battleTraceShipper.ts
chown root:root /var/www/app/app/components/features/battle/BattleLayout.tsx
chown root:root /var/www/app/app/components/features/battle/battleTraceShipper.ts
ls -la /var/www/app/app/components/features/battle/BattleLayout.tsx /var/www/app/app/components/features/battle/battleTraceShipper.ts
echo "=== verify canary removed at source ==="
grep -c "TRACE NO-LOSS" /var/www/app/app/components/features/battle/BattleLayout.tsx
echo "=== verify traceSessionId added at source ==="
grep -c "traceSessionId" /var/www/app/app/components/features/battle/battleTraceShipper.ts
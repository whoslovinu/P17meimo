cd /var/www/app
echo "--- BUILD_ID ---"
cat .next/BUILD_ID
echo
echo "--- shipper markers in chunks ---"
grep -l "battle-trace-bootstrap" .next/static/chunks/*.js 2>/dev/null | head -3
echo "---"
grep -l "battle-trace" .next/static/chunks/*.js 2>/dev/null | head -10
echo "---"
echo "--- files in place ---"
ls -la app/components/features/battle/battleTraceShipper.ts
ls -la app/components/features/battle/LoadingScreen.tsx
ls -la app/components/features/battle/SpineViewer.tsx
ls -la app/components/features/battle/BattleLayout.tsx
echo "DONE"

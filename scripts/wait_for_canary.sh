echo "=== Poll PM2 for canary events ==="
# Canary events use 5 distinct allow-list events. After the deploy at BUILD_ID UTOsiXChxG0c_7JMhtKjW,
# the next real browser session will fire these from the new useEffect:
# 1) [BattleLayout] render-state   (extra one right after mount)
# 2) [SpineViewer] pixi-init-complete (will be 2nd occurrence if normal session)
# 3) [SpineViewer] character-mounted (will be 2nd occurrence)
# 4) [BattleLayout] canvas-dom   (would be FIRST occurrence since real sessions have 0)
# 5) [BattleLayout] first-visible-frame-ready (would be FIRST occurrence since real sessions have 0)

echo "baseline line count: $(grep -c 'DIAG]' /root/.pm2/logs/repark-h5-out-0.log) at $(date -u +%H:%M:%S)"
echo

for i in $(seq 1 18); do
  sleep 10
  NOW_LINES=$(grep -c 'DIAG]' /root/.pm2/logs/repark-h5-out-0.log)
  CANVAS_DOM=$(grep -c '\[BattleLayout\] canvas-dom' /root/.pm2/logs/repark-h5-out-0.log)
  FIRST_FRAME=$(grep -c '\[BattleLayout\] first-visible-frame-ready' /root/.pm2/logs/repark-h5-out-0.log)
  PIXI=$(grep -c '\[SpineViewer\] pixi-init-complete' /root/.pm2/logs/repark-h5-out-0.log)
  RENDER=$(grep -c '\[BattleLayout\] render-state' /root/.pm2/logs/repark-h5-out-0.log)
  echo "[$(date -u +%H:%M:%S)] poll $i  DIAG=$NOW_LINES  canvas-dom=$CANVAS_DOM  first-frame=$FIRST_FRAME  pixi-init=$PIXI  render-state=$RENDER"
done
echo
echo "=== last 30 DIAG events ==="
python3 -c "
import json, subprocess
r = subprocess.run(['grep', '-a', 'DIAG]', '/root/.pm2/logs/repark-h5-out-0.log'], capture_output=True, text=True)
lines = r.stdout.split(chr(10))
for ln in lines[-30:]:
    if ln.strip():
        try:
            rec = json.loads(ln)
            msg = rec.get('message','')
            # Only show first line
            first = msg.split(chr(10))[0][:200]
            print(rec.get('timestamp',''), '|', first)
        except: pass
"
echo "DONE"
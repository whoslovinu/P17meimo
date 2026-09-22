echo "=== Final poll: 60s wait for new browser session with canary ==="
START=$(date +%s)
END=$((START + 65))
while [ $(date +%s) -lt $END ]; do
  N=$(grep -c 'DIAG]' /root/.pm2/logs/repark-h5-out-0.log)
  CV=$(grep -c '\[BattleLayout\] canvas-dom' /root/.pm2/logs/repark-h5-out-0.log)
  FF=$(grep -c '\[BattleLayout\] first-visible-frame-ready' /root/.pm2/logs/repark-h5-out-0.log)
  PX=$(grep -c '\[SpineViewer\] pixi-init-complete' /root/.pm2/logs/repark-h5-out-0.log)
  echo "[$(date -u +%H:%M:%S)] DIAG=$N  canvas-dom=$CV  first-frame=$FF  pixi=$PX"
  sleep 10
done
echo
echo "=== last 5 DIAG events ==="
python3 -c "
import json, subprocess
r = subprocess.run(['grep', '-a', 'DIAG]', '/root/.pm2/logs/repark-h5-out-0.log'], capture_output=True, text=True)
for ln in r.stdout.split(chr(10))[-5:]:
    if ln.strip():
        try:
            rec = json.loads(ln)
            msg = rec.get('message','')
            first = msg.split(chr(10))[0][:220]
            print(rec.get('timestamp',''), '|', first)
        except: pass
"
echo "DONE"
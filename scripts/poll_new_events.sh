echo "=== poll for any new battle-trace lines after ts 1787683518724 (18:45:18 UTC) ==="
START_LINES=$(grep -c 'battle-trace' /root/.pm2/logs/repark-h5-out-0.log)
echo "baseline lines: $START_LINES at $(date -u +%H:%M:%S)"

for i in $(seq 1 6); do
  sleep 10
  CUR=$(grep -c 'battle-trace' /root/.pm2/logs/repark-h5-out-0.log)
  echo "t=$(date -u +%H:%M:%S): battle-trace lines = $CUR (delta=$((CUR-START_LINES)))"
done

echo
echo "=== final dump of all battle-trace lines ==="
grep -E '\[DIAG\].*\[sid=battle-trace\]' /root/.pm2/logs/repark-h5-out-0.log | python3 -c '
import sys, json, re
seen = set()
for ln in sys.stdin:
    try:
        rec = json.loads(ln)
    except: continue
    msg = rec.get("message","")
    for sub in msg.split("\n"):
        m = re.match(r"\[DIAG\]\[INFO\]\[battle-trace(?:-bootstrap)?\]\[sid=([^\]]+)\]\[t=(\d+)\] (\{.*\})", sub.strip())
        if m:
            sid, ts, payload = m.group(1), m.group(2), m.group(3)
            key = (sid, ts)
            if key not in seen:
                seen.add(key)
                print(f"  ts={ts}  sid={sid[:12]}  payload={payload[:120]}")
'
import json, subprocess, re

# Pull all battle-trace pm2 lines
res = subprocess.check_output(['bash', '-c', "grep 'battle-trace' /root/.pm2/logs/repark-h5-out-0.log"], text=True)
lines = res.strip().split('\n')
print(f'total battle-trace pm2 lines: {len(lines)}')
print()

for i, ln in enumerate(lines):
    try:
        rec = json.loads(ln)
    except json.JSONDecodeError:
        print(f'  line {i}: NOT JSON')
        continue
    ts = rec.get('timestamp', '?')
    msg = rec.get('message', '')
    # First 80 chars + length
    head = msg[:120].replace('\n', '⏎')
    print(f'--- line {i}  wall={ts}  msg_bytes={len(msg)}')
    print(f'    head: {head}')
    # Show all [DIAG] markers in this line
    diags = re.findall(r'\[DIAG\]\[INFO\]\[battle-trace(?:-bootstrap)?\]\[sid=([^\]]+)\]\[t=(\d+)\] \{[^}]*"event":"([^"]+)"', msg)
    for j, (sid, ts_, evt) in enumerate(diags):
        print(f'    [{j}] sid={sid}  t={ts_}  event={evt}')
    print()
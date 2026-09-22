import json, subprocess, re

res = subprocess.check_output(['bash', '-c', "grep 'battle-trace' /root/.pm2/logs/repark-h5-out-0.log"], text=True)
lines = res.strip().split('\n')

# Focus on the two new bootstrap events
for i in [1, 2]:
    rec = json.loads(lines[i])
    msg = rec.get('message', '')
    print(f'=== line {i} ===')
    print(f'wall: {rec.get("timestamp")}')
    print(f'full message:')
    print(msg)
    print()
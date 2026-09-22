import json, subprocess
r = subprocess.run(['grep', '-a', 'DIAG]', '/root/.pm2/logs/repark-h5-out-0.log'], capture_output=True, text=True)
lines = r.stdout.split('\n')
print(f'total DIAG lines: {len(lines)}')
print()
print('--- last 10 ---')
for ln in lines[-10:]:
    print(ln[:300])
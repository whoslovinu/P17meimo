import json, subprocess
# run grep + tail
out = subprocess.check_output(['bash', '-c', "grep 'battle-trace' /root/.pm2/logs/repark-h5-out-0.log | tail -1"], text=True).strip()
if not out:
    print('NO LINE')
else:
    m = json.loads(out)['message']
    print('total_lines_in_message:', m.count('\n') + 1)
    print('total_DIAG_markers:', m.count('[DIAG]'))
    print('total_battle-trace tokens:', m.count('battle-trace'))
    # split into per-event lines
    for i, line in enumerate(m.split('\n')[:20]):
        print(f'  line {i}: {line[:90]}...')

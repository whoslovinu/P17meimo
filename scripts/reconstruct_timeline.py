import json, subprocess
out = subprocess.check_output(['bash', '-c', "grep 'battle-trace' /root/.pm2/logs/repark-h5-out-0.log | tail -1"], text=True).strip()
m = json.loads(out)['message']
lines = m.split('\n')

# Parse each line into {ts, event, gate}
import re
parsed = []
for ln in lines:
    if not ln.strip():
        continue
    # Format: [DIAG][INFO][battle-trace][sid=...][t=12345] {"event":"...",...}
    m2 = re.match(r'\[DIAG\]\[INFO\]\[battle-trace\]\[sid=([^\]]+)\]\[t=(\d+)\] (\{.*\})', ln)
    if not m2:
        continue
    sid = m2.group(1)
    ts = int(m2.group(2))
    payload = json.loads(m2.group(3))
    parsed.append({'sid': sid, 'ts': ts, 'event': payload.get('event', '?'), 'payload': payload})

# Sort by ts
parsed.sort(key=lambda x: x['ts'])

if not parsed:
    print('NO PARSED EVENTS')
else:
    t0 = parsed[0]['ts']
    print(f'session-id: {parsed[0]["sid"]}')
    print(f'events: {len(parsed)}')
    print(f't0: {t0}')
    print()
    print(f"{'T+ms':>7} | {'event':<48} | gate state (compact)")
    print('-' * 110)
    for p in parsed:
        gate = p['payload']
        keys = ['battleInit','isSpineLoaded','isStage2Loaded','isStage3Loaded','isStage4Loaded','isAssetLoaded','isCurrentModelRendered','isReadyForLiveView']
        gs = ' '.join(f"{k[2:5]}{int(gate.get(k, 0))}" for k in keys)
        print(f"{p['ts']-t0:>7} | {p['event']:<48} | {gs}")

    print()
    print('=== Key intervals ===')
    events = {p['event']: p for p in parsed}
    pairs = [
        ('progress=100 to afterrender-fired',
         '[LoadingScreen] progress=100', '[SpineViewer] afterrender-fired'),
        ('afterrender-fired to first-visible-frame-ready',
         '[SpineViewer] afterrender-fired', '[BattleLayout] first-visible-frame-ready'),
        ('first-visible-frame-ready to gone=true',
         '[BattleLayout] first-visible-frame-ready', '[LoadingScreen] gone=true'),
        ('first-visible-frame-ready to onComplete',
         '[BattleLayout] first-visible-frame-ready', '[LoadingScreen] onComplete'),
    ]
    for label, a, b in pairs:
        if a in events and b in events:
            dt = events[b]['ts'] - events[a]['ts']
            print(f'  {label}: {dt} ms')
        else:
            missing = []
            if a not in events: missing.append(a)
            if b not in events: missing.append(b)
            print(f'  {label}: MISSING — {missing}')

    # canvas-dom (last in chain)
    cv = [p for p in parsed if p['event'] == '[BattleLayout] canvas-dom']
    if cv:
        c = cv[0]['payload'].get('canvas', {})
        print()
        print(f'=== canvas-dom: exists={c.get("exists")}, width={c.get("width")}, height={c.get("height")}, clientWidth={c.get("clientWidth")}, clientHeight={c.get("clientHeight")}, opacity={c.get("opacity")}, display={c.get("display")}, visibility={c.get("visibility")} ===')
    else:
        print()
        print('=== canvas-dom: NOT IN SYNTHETIC DATA ===')

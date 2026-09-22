import json, subprocess, re
from collections import defaultdict, Counter

r = subprocess.run(['grep', '-a', 'DIAG]', '/root/.pm2/logs/repark-h5-out-0.log'], capture_output=True, text=True)
lines = [ln for ln in r.stdout.split('\n') if ln.strip()]

events = []
for ln in lines:
    try:
        rec = json.loads(ln)
    except json.JSONDecodeError:
        continue
    msg = rec.get('message', '')
    for sub in msg.split('\n'):
        m = re.match(r'\[DIAG\]\[(\w+)\]\[([^\]]+)\]\[sid=([^\]]+)\]\[t=(\d+)\] (\{.*\})', sub.strip())
        if not m:
            continue
        level, origin, sid, ts, payload = m.group(1), m.group(2), m.group(3), int(m.group(4)), m.group(5)
        try:
            p = json.loads(payload)
        except json.JSONDecodeError:
            p = {'_parse_error': True}
        events.append({'ts': ts, 'wall': rec.get('timestamp'), 'origin': origin, 'sid': sid, 'level': level, 'event': p.get('event', '?'), 'payload': p})

# Save to file for downstream analysis
with open('/tmp/all_diag_events.json', 'w') as f:
    json.dump(events, f, indent=2)

# Print per-session timeline summary
by_sid = defaultdict(list)
for e in events:
    by_sid[e['sid']].append(e)

print('=' * 80)
print('SHIPPER RECEIPT PROOF — ALL REAL USER SESSIONS')
print('=' * 80)

for sid, evs in by_sid.items():
    evs.sort(key=lambda x: x['ts'])
    origin_tags = Counter(e['origin'] for e in evs)
    event_types = Counter(e['event'] for e in evs)
    first = evs[0]
    last = evs[-1]
    duration_s = (last['ts'] - first['ts']) / 1000

    print()
    print(f'### Session: {sid}')
    print(f'    events: {len(evs)}')
    print(f'    first:  {first["wall"]} (ts={first["ts"]})')
    print(f'    last:   {last["wall"]} (ts={last["ts"]})')
    print(f'    span:   {duration_s:.1f} s')
    print(f'    origin tags: {dict(origin_tags)}')
    print()
    print(f'    EVENT TYPE BREAKDOWN (event → count):')
    for et, cnt in sorted(event_types.items(), key=lambda kv: -kv[1]):
        print(f'      {cnt:4d} × {et}')

# Now reconstruct timeline for Real Session #2 (sess-1787683) — most recent and richest
print()
print('=' * 80)
print('REAL SESSION #2 (sess-1787683) — TIMELINE RECONSTRUCTION')
print('=' * 80)

evs2 = sorted(by_sid['sess-1787683'], key=lambda x: x['ts'])
t0 = evs2[0]['ts']
last_event_per_type = {}
for e in evs2:
    last_event_per_type[e['event']] = e

# Show first occurrence of each distinct event
seen = set()
for e in evs2:
    if e['event'] in seen:
        continue
    seen.add(e['event'])
    p = e['payload']
    dt = e['ts'] - t0
    gate_keys = ['battleInit','isSpineLoaded','isStage2Loaded','isStage3Loaded','isStage4Loaded','isAssetLoaded','isCurrentModelRendered','isReadyForLiveView']
    gs = ''.join('1' if p.get(k, False) else '0' for k in gate_keys)
    print(f'  T+{dt:>6} ms  {e["event"]:<48}  gate={gs}  wall={e["wall"]}')

# Key intervals
print()
print('KEY INTERVALS:')
def ts_for(name):
    return next((e['ts'] for e in evs2 if e['event'] == name), None)

pairs = [
    ('[BattleLayout] render-state → [SpineViewer] pixi-init-complete', '[BattleLayout] render-state', '[SpineViewer] pixi-init-complete'),
    ('pixi-init → bg-mounted', '[SpineViewer] pixi-init-complete', '[SpineViewer] bg-mounted'),
    ('bg → character', '[SpineViewer] bg-mounted', '[SpineViewer] character-mounted'),
    ('character → halo', '[SpineViewer] character-mounted', '[SpineViewer] halo-mounted'),
    ('halo → progress=100 (first)', '[SpineViewer] halo-mounted', '[LoadingScreen] progress=100'),
    ('progress=100 (first) → dismiss-blocked (first)', '[LoadingScreen] progress=100', '[LoadingScreen] dismiss-blocked-no-canvas'),
    ('progress=100 (first) → stage2 (first)', '[LoadingScreen] progress=100', '[SpineViewer] stage2-mounted'),
    ('stage2 → stage3', '[SpineViewer] stage2-mounted', '[SpineViewer] stage3-mounted'),
    ('stage3 → stage4', '[SpineViewer] stage3-mounted', '[SpineViewer] stage4-mounted'),
    ('progress=100 (first) → stage4', '[LoadingScreen] progress=100', '[SpineViewer] stage4-mounted'),
    ('progress=100 (last) → dismiss-blocked (last)', '[LoadingScreen] progress=100', '[LoadingScreen] dismiss-blocked-no-canvas'),
]
for label, a, b in pairs:
    ta = ts_for(a)
    tb = ts_for(b)
    if ta and tb:
        print(f'  {label}: {tb - ta} ms')
    else:
        miss = []
        if not ta: miss.append(a)
        if not tb: miss.append(b)
        print(f'  {label}: MISSING — {miss}')
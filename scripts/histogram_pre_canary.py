import json, subprocess, re
from collections import Counter

r = subprocess.run(['grep', '-a', 'DIAG]', '/root/.pm2/logs/repark-h5-out-0.log'], capture_output=True, text=True)
lines = [ln for ln in r.stdout.split('\n') if ln.strip()]

# Parse each JSON line, extract event
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
        events.append({'ts': ts, 'wall': rec.get('timestamp'), 'origin': origin, 'sid': sid, 'event': p.get('event', '?')})

# Identify real sessions by origin + sid
# Real sessions all use origin='shipper' and sid='sess-1787681' or 'sess-1787683'
# Exclude: origin='battle-trace' (my synthetic), origin='battle-trace-bootstrap', origin='shipper-canary' (my synthetic canary)

REAL_ORIGINS = {'shipper'}
SYNTHETIC_ORIGINS = {'battle-trace', 'battle-trace-bootstrap', 'shipper-canary', 'shipper-battle-trace'}

real_events = [e for e in events if e['origin'] in REAL_ORIGINS and not e['origin'] in SYNTHETIC_ORIGINS]

# Group by sid
from collections import defaultdict
by_sid = defaultdict(list)
for e in real_events:
    by_sid[e['sid']].append(e)

print(f'TOTAL real events: {len(real_events)}')
print(f'Unique real sids: {sorted(by_sid.keys())}')
print()

# Pre-canary = events with ts < 1787685708127 (the canary synthetic start)
CANARY_TS = 1787685708127
pre_canary = [e for e in real_events if e['ts'] < CANARY_TS]

print(f'PRE-CANARY real events: {len(pre_canary)}')
pre_by_sid = defaultdict(list)
for e in pre_canary:
    pre_by_sid[e['sid']].append(e)
print(f'Pre-canary real sids: {sorted(pre_by_sid.keys())}')
print()

# Histogram per session
EXPECTED_EVENTS = [
    'session-bootstrap',
    '[BattleLayout] render-state',
    '[SpineViewer] pixi-init-complete',
    '[SpineViewer] bg-mounted',
    '[SpineViewer] character-mounted',
    '[SpineViewer] halo-mounted',
    '[SpineViewer] stage2-mounted',
    '[SpineViewer] stage3-mounted',
    '[SpineViewer] stage4-mounted',
    '[LoadingScreen] progress=100',
    '[LoadingScreen] dismiss-blocked-no-canvas',
    '[SpineViewer] afterrender-fired',
    '[BattleLayout] first-visible-frame-ready',
    '[LoadingScreen] exit-start',
    '[LoadingScreen] gone=true',
    '[LoadingScreen] onComplete',
    '[BattleLayout] canvas-dom',
]

# Combine both real sessions (pre-canary) into one histogram
combined = Counter()
for e in pre_canary:
    combined[e['event']] += 1

print('=' * 80)
print('PRE-CANARY REAL EVENT HISTOGRAM (combined sess-1787681 + sess-1787683)')
print('=' * 80)
print(f'  total events: {sum(combined.values())}')
print()
for evt in EXPECTED_EVENTS:
    cnt = combined.get(evt, 0)
    bar = '#' * min(cnt, 60) if cnt > 0 else ''
    marker = '  ' if cnt == 0 else '  '
    print(f'  {cnt:4d}  {marker}{evt}{bar}')

print()
print('=' * 80)
print('PER-SESSION BREAKDOWN (pre-canary)')
print('=' * 80)
for sid in sorted(pre_by_sid.keys()):
    evs = pre_by_sid[sid]
    counts = Counter(e['event'] for e in evs)
    print(f'\n### {sid}  ({len(evs)} events)')
    for evt in EXPECTED_EVENTS:
        cnt = counts.get(evt, 0)
        if cnt > 0:
            print(f'    {cnt:4d}  {evt}')

# Last spine lifecycle event per session
print()
print('=' * 80)
print('LAST SPINE LIFECYCLE EVENT PER REAL SESSION')
print('=' * 80)
spine_events = {'[SpineViewer] pixi-init-complete', '[SpineViewer] bg-mounted', '[SpineViewer] character-mounted',
                '[SpineViewer] halo-mounted', '[SpineViewer] stage2-mounted', '[SpineViewer] stage3-mounted',
                '[SpineViewer] stage4-mounted', '[SpineViewer] afterrender-fired',
                '[BattleLayout] first-visible-frame-ready'}
for sid in sorted(pre_by_sid.keys()):
    evs = [e for e in pre_by_sid[sid] if e['event'] in spine_events]
    evs.sort(key=lambda x: x['ts'])
    if evs:
        last = evs[-1]
        print(f'  {sid}: LAST spine/event-trace event = {last["event"]}  at wall={last["wall"]}  ts={last["ts"]}')
    else:
        print(f'  {sid}: NO spine lifecycle events found')
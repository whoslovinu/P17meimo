import json, subprocess, re
from collections import defaultdict, Counter

r = subprocess.run(['grep', '-a', 'DIAG]', '/root/.pm2/logs/repark-h5-out-0.log'], capture_output=True, text=True)
lines = [ln for ln in r.stdout.split('\n') if ln.strip()]

# Parse each JSON line, extract origin + event + ts
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
        events.append({'ts': ts, 'wall': rec.get('timestamp'), 'origin': origin, 'sid': sid, 'level': level, 'event': p.get('event', '?')})

print(f'total events: {len(events)}')

# Group by sid (truncated server-side to 12 chars)
by_sid = defaultdict(list)
for e in events:
    by_sid[e['sid']].append(e)

print(f'unique sids (truncated to 12): {len(by_sid)}')
for sid, evs in by_sid.items():
    origin_tags = Counter(e['origin'] for e in evs)
    event_types = Counter(e['event'] for e in evs)
    first_wall = min(e['wall'] for e in evs)
    last_wall = max(e['wall'] for e in evs)
    print()
    print(f'=== sid={sid}  count={len(evs)}  first={first_wall}  last={last_wall}')
    print(f'   origin tags: {dict(origin_tags)}')
    print(f'   event types: {dict(event_types)}')
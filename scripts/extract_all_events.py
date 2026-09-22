import json, subprocess, re

# Look for any new pm2 line containing the bootstrap sid "battle-trace" in last
# 10 minutes wall clock, regardless of [DIAG] origin
res = subprocess.check_output(['bash', '-c', "grep -E '\\[DIAG\\].*\\[sid=battle-trace\\]' /root/.pm2/logs/repark-h5-out-0.log"], text=True)
lines = res.strip().split('\n')
print(f'total lines matching [DIAG]...[sid=battle-trace]...: {len(lines)}')

# For each, extract sid + event + ts
events_by_session = {}
for ln in lines:
    try:
        rec = json.loads(ln)
    except json.JSONDecodeError:
        continue
    msg = rec.get('message', '')
    wall = rec.get('timestamp', '')
    for sub in msg.split('\n'):
        m = re.match(r'\[DIAG\]\[INFO\]\[battle-trace(?:-bootstrap)?\]\[sid=([^\]]+)\]\[t=(\d+)\] (\{.*\})', sub.strip())
        if not m:
            continue
        sid = m.group(1)
        ts = int(m.group(2))
        try:
            payload = json.loads(m.group(3))
        except json.JSONDecodeError:
            payload = {'_parse_error': True}
        key = (sid, ts)
        if key not in events_by_session or wall > events_by_session[key]['wall']:
            events_by_session[key] = {'sid': sid, 'ts': ts, 'wall': wall, 'event': payload.get('event', '?'), 'payload': payload}

# Group by sid (recognize that "battle-trace" is shared because server-side truncates to 12 chars)
# Actually use origin + sid as discriminator
events = list(events_by_session.values())
print(f'total parsed events: {len(events)}')

# Sort by ts
events.sort(key=lambda x: x['ts'])
# Print all
for e in events:
    print(f"  wall={e['wall']}  ts={e['ts']}  origin-tag-from-wall?  event={e['event']}")
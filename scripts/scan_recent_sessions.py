import json, subprocess, re, datetime
from collections import defaultdict

# 1) Get all battle-trace lines from pm2 out log
res = subprocess.check_output(['bash', '-c', "grep 'battle-trace' /root/.pm2/logs/repark-h5-out-0.log"], text=True)
lines = res.strip().split('\n')
print(f'total battle-trace pm2 lines: {len(lines)}')

# 2) Parse each JSON line; expand multi-event message into separate events
events = []
synth_session_ids = set()
for ln in lines:
    try:
        rec = json.loads(ln)
    except json.JSONDecodeError:
        continue
    msg = rec.get('message', '')
    ts_wall = rec.get('timestamp', '')
    # each line may contain multiple [DIAG]...\n separated events
    for sub in msg.split('\n'):
        m = re.match(r'\[DIAG\]\[INFO\]\[battle-trace(?:-bootstrap)?\]\[sid=([^\]]+)\]\[t=(\d+)\] (\{.*\})', sub.strip())
        if not m:
            continue
        sid = m.group(1)
        ts = int(m.group(2))
        try:
            payload = json.loads(m.group(3))
        except json.JSONDecodeError:
            payload = {'_parse_error': m.group(3)[:120]}
        events.append({
            'sid': sid,
            'ts': ts,
            'wall': ts_wall,
            'event': payload.get('event', '?'),
            'payload': payload,
        })
        # Synthetic session detection: my earlier synthetic payload had sid
        # 'battle-trace-fake-<timestamp>' or came from a curl POST (no UUID)
        if sid.startswith('battle-trace-fake-') or re.match(r'^battle-trace$', sid):
            synth_session_ids.add(sid)

print(f'total parsed events: {len(events)}')

# 3) Filter to last 10 minutes wall clock
now = datetime.datetime.utcnow()
cutoff = now - datetime.timedelta(minutes=10)
def parse_wall(s):
    # format: 2026-08-25 16:42:49
    try:
        return datetime.datetime.strptime(s, '%Y-%m-%d %H:%M:%S')
    except Exception:
        return None
events_recent = []
for e in events:
    w = parse_wall(e['wall'])
    if w is None or w >= cutoff:
        events_recent.append(e)
print(f'events in last 10 minutes: {len(events_recent)}')

# 4) Group by sid
by_sid = defaultdict(list)
for e in events_recent:
    by_sid[e['sid']].append(e)

print(f'unique sessionIds in last 10 min: {len(by_sid)}')
for sid in sorted(by_sid.keys(), key=lambda s: max(e['ts'] for e in by_sid[s])):
    is_synth = sid in synth_session_ids
    tag = '[SYNTH]' if is_synth else '[REAL]'
    latest_ts = max(e['ts'] for e in by_sid[sid])
    wall_latest = max(e['wall'] for e in by_sid[sid])
    print(f'  {tag} sid={sid}  events={len(by_sid[sid])}  latest_wall={wall_latest}  ts={latest_ts}')

# 5) Save to /tmp for downstream steps
with open('/tmp/battle_events_recent.json', 'w') as f:
    json.dump({
        'cutoff': cutoff.isoformat(),
        'synth_sids': list(synth_session_ids),
        'sessions': {sid: by_sid[sid] for sid in by_sid},
    }, f, indent=2, ensure_ascii=False)
print('saved /tmp/battle_events_recent.json')
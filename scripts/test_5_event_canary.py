import json, subprocess, time

# Send 5 sequential events through /api/diag/client-log as the shipper would.
# This proves the ENDPOINT and SHIPPER PIPELINE accept 5 events.
# The browser shipper sends the SAME shape (origin='shipper' or 'battle-trace').
# We've already proven the SHIPPER side works via 405 events from real browsers.
# This test isolates the SHIP→SERVER path.

T0 = int(time.time() * 1000)
sid = f'shipper-canary-{T0}'

events = [
    {'ts': T0,       'level': 'info', 'msg': '{"event":"[BattleLayout] render-state","pathname":"/battle","battleInit":true,"isSpineLoaded":false,"isStage2Loaded":false,"isStage3Loaded":false,"isStage4Loaded":false,"isAssetLoaded":false,"isCurrentModelRendered":false,"isReadyForLiveView":false}'},
    {'ts': T0+100,   'level': 'info', 'msg': '{"event":"[SpineViewer] pixi-init-complete","pathname":"/battle","battleInit":true,"isSpineLoaded":false}'},
    {'ts': T0+200,   'level': 'info', 'msg': '{"event":"[SpineViewer] character-mounted","pathname":"/battle","battleInit":true,"isSpineLoaded":true}'},
    {'ts': T0+300,   'level': 'info', 'msg': '{"event":"[BattleLayout] canvas-dom","pathname":"/battle","battleInit":true,"isSpineLoaded":true,"canvas":{"exists":true,"width":1080,"height":1920,"clientWidth":360,"clientHeight":640}}'},
    {'ts': T0+400,   'level': 'info', 'msg': '{"event":"[BattleLayout] first-visible-frame-ready","pathname":"/battle","battleInit":true,"isSpineLoaded":true,"isCurrentModelRendered":true}'},
]

payload = {'sessionId': sid, 'origin': 'shipper-canary', 'events': events}
body = json.dumps(payload)
print(f'posting {len(events)} events with sid={sid}')

r = subprocess.run(
    ['curl', '-sS', '-X', 'POST',
     '-H', 'Content-Type: application/json',
     '-d', body,
     'http://98.93.252.250/api/diag/client-log'],
    capture_output=True, text=True
)
print(f'response: {r.stdout.strip()}')

# Wait 2s for pm2 to flush
time.sleep(2)

# Now grep pm2 for our sid (note: server slices to 12 chars: 'shipper-cana')
sliced = sid[:12]
print(f'\\nchecking pm2 for sid={sliced}...')

r2 = subprocess.run(['grep', '-a', f'sid={sliced}', '/root/.pm2/logs/repark-h5-out-0.log'], capture_output=True, text=True)
hits = [ln for ln in r2.stdout.split('\n') if sliced in ln]
print(f'raw lines containing sid: {len(hits)}')

# Count events
event_count = 0
for ln in hits:
    msg = json.loads(ln).get('message', '')
    event_count += msg.count('[DIAG]')
print(f'parsed DIAG events in those lines: {event_count}')

# Print each
for i, ln in enumerate(hits):
    rec = json.loads(ln)
    msg = rec.get('message', '')
    for sub in msg.split('\n'):
        if '[DIAG]' in sub:
            print(f'  [{i}] {sub[:200]}')
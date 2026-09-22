import re
chunk = '/var/www/app/.next/static/chunks/2622.4ba50e72f806cd16.js'
with open(chunk) as f:
    txt = f.read()
# The 5 shipBattleTrace calls in source code:
# shipBattleTrace('[BattleLayout] render-state', ...)
# shipBattleTrace('[SpineViewer] pixi-init-complete', ...)
# shipBattleTrace('[SpineViewer] character-mounted', ...)
# shipBattleTrace('[BattleLayout] canvas-dom', ...)
# shipBattleTrace('[BattleLayout] first-visible-frame-ready', ...)
# After minification, these event-name strings stay (they're allow-list checks).
# The minified function call is `W(e,t)` where W=shipBattleTrace.
# So the bundle should contain all 5 event names AND multiple calls to `W(`
# But "W(" is too generic. Let's just check that all 5 names appear at least
# once in the SAME function body (the minified canary useEffect).

# Look for the canary pattern: a sequence of 5 event names separated by ","
# within a short distance.
pattern = r'render-state.{0,50}pixi-init-complete.{0,50}character-mounted.{0,50}canvas-dom.{0,50}first-visible-frame-ready'
matches = list(re.finditer(pattern, txt))
print(f'canary signature matches (all 5 event names within ~50 chars): {len(matches)}')
for m in matches:
    print(f'  offset: {m.start()}, content: {m.group(0)[:200]}')

# Also check that all 5 events are in the allow-list string
allow_list_pat = r'\\"\[BattleLayout\\] render-state\\".*?\\"\[BattleLayout\\] canvas-dom\\"'
m2 = re.search(allow_list_pat, txt)
if m2:
    print(f'\\nallow-list section found, length: {m2.end() - m2.start()}')
    print(f'  contains render-state: {m2.start() > 0 and "render-state" in m2.group(0)}')
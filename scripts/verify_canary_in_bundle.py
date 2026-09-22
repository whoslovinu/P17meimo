import re
chunk = '/var/www/app/.next/static/chunks/2622.4ba50e72f806cd16.js'
with open(chunk) as f:
    txt = f.read()
print(f'chunk size: {len(txt)} bytes')
# Search for canary markers
print('contains "render-state":', txt.count('render-state'))
print('contains "TRACE NO-LOSS":', txt.count('TRACE NO-LOSS'))
print('contains "first-visible-frame-ready":', txt.count('first-visible-frame-ready'))
print('contains "canvas-dom":', txt.count('canvas-dom'))
print('contains "character-mounted":', txt.count('character-mounted'))
print('contains "pixi-init-complete":', txt.count('pixi-init-complete'))
# Look for the 5 shipBattleTrace calls in this file
print('contains "shipBattleTrace":', txt.count('shipBattleTrace'))
# Find around "first-visible-frame-ready"
idx = txt.find('first-visible-frame-ready')
if idx > 0:
    print(f'\\n--- context around first-visible-frame-ready (offset {idx}) ---')
    print(txt[max(0,idx-200):idx+200])
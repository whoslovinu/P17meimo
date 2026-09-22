"""Search PIXI for PUBLIC-API first-render/afterrender hooks."""
import os, re, json

root = '/var/www/app/node_modules/pixi.js'

# Patterns for public-API render hooks
patterns = {
    'Application.render': re.compile(r'Application[^;]*\brender\('),
    'app\.render\(\)': re.compile(r'\bapp\.render\(\)'),
    'renderer\.render': re.compile(r'renderer\.render'),
    'TickerPlugin.*render': re.compile(r'TickerPlugin.*render'),
    'ticker.*emit': re.compile(r'ticker\.(add|addOnce|remove)'),
    'public.*postrender': re.compile(r'(public|@public)[^a-z]+postrender', re.IGNORECASE),
}

# Search Application-related files
target_files = [
    '/lib/app/Application.d.ts',
    '/lib/app/Application.mjs',
    '/lib/app/Application.js',
    '/lib/app/ApplicationMixins.d.ts',
    '/lib/app/TickerPlugin.d.ts',
    '/lib/app/TickerPlugin.mjs',
    '/lib/app/TickerPlugin.js',
    '/lib/app/ResizePlugin.d.ts',
    '/lib/rendering/renderers/shared/system/AbstractRenderer.d.ts',
    '/lib/rendering/renderers/shared/system/AbstractRenderer.mjs',
    '/lib/rendering/renderers/shared/system/AbstractRenderer.js',
    '/lib/rendering/renderers/shared/system/SystemRunner.d.ts',
    '/lib/rendering/renderers/shared/system/SystemRunner.mjs',
    '/lib/rendering/renderers/shared/system/SystemRunner.js',
    '/lib/ticker/Ticker.d.ts',
    '/lib/ticker/Ticker.mjs',
    '/lib/ticker/Ticker.js',
    '/index.d.ts',
    '/lib/index.d.ts',
]

for rel in target_files:
    path = root + rel
    if not os.path.exists(path):
        print(f'  MISSING: {rel}')
        continue
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    print(f'\n=== {rel} ({len(content)} bytes) ===')
    # Find render-related lines
    for i, line in enumerate(content.split('\n'), 1):
        if re.search(r'\b(render|postrender|prerender|runners?|ticker)\b', line, re.IGNORECASE):
            stripped = line.strip()
            if 'afterrender' in stripped:
                continue
            if len(stripped) > 200:
                stripped = stripped[:200] + '…'
            print(f'  L{i}: {stripped}')
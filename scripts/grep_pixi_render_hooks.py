"""Grep PIXI source for postrender usage patterns and official docs guidance."""
import os, re, json

root = '/var/www/app/node_modules/pixi.js'
patterns = {
    'postrender_runner': re.compile(r'\bpostrender\b'),
    'afterrender': re.compile(r'afterrender'),
    'firstRender': re.compile(r'firstRender|first_frame|firstFrame|first_render'),
    'runners\.postrender': re.compile(r'runners\.postrender'),
}

results = {k: [] for k in patterns}
for dirpath, _, filenames in os.walk(root):
    for fn in filenames:
        if not fn.endswith(('.js', '.mjs', '.d.ts', '.md')):
            continue
        path = os.path.join(dirpath, fn)
        try:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except Exception:
            continue
        for label, pat in patterns.items():
            for m in pat.finditer(content):
                line_start = content.rfind('\n', 0, m.start()) + 1
                line_end = content.find('\n', m.end())
                if line_end < 0:
                    line_end = len(content)
                line_no = content[:m.start()].count('\n') + 1
                snippet = content[line_start:line_end].strip()
                # Skip if snippet too long
                if len(snippet) > 250:
                    snippet = snippet[:250] + '…'
                results[label].append({'file': path.replace(root, ''), 'line': line_no, 'snippet': snippet})

# Also search the docs dist if any
docs_root = '/var/www/app/node_modules/pixi.js/docs'
if os.path.isdir(docs_root):
    for dirpath, _, filenames in os.walk(docs_root):
        for fn in filenames:
            path = os.path.join(dirpath, fn)
            try:
                with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
            except Exception:
                continue
            for label, pat in patterns.items():
                for m in pat.finditer(content):
                    line_no = content[:m.start()].count('\n') + 1
                    snippet = content[max(0, m.start()-80):m.end()+200].replace('\n', ' ')[:400]
                    results[label].append({'file': path.replace(root, ''), 'line': line_no, 'snippet': snippet, 'docs': True})

print(json.dumps({k: v for k, v in results.items()}, indent=2, ensure_ascii=False))
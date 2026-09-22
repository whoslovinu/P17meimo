import base64, sys, os
data = sys.stdin.buffer.read()
b64 = base64.b64encode(data).decode()
target = '/var/www/app/app/components/features/battle/SpineViewer.tsx'
os.makedirs(os.path.dirname(target), exist_ok=True)
with open(target, 'wb') as f:
    f.write(data)
print(f'OK {len(data)} bytes')

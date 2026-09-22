#!/usr/bin/env python3
import json, urllib.request, urllib.error
ORIGIN = "http://localhost:3000"
def post(path, body):
    req = urllib.request.Request(
        f"http://localhost:3000{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Origin": ORIGIN},
        method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), dict(e.headers)

print("=== A. WRONG password ===")
print(post("/api/admin/login", {"password": "WRONG"}))

print("\n=== B. CORRECT password ===")
print(post("/api/admin/login", {"password": "giys-agjj-niqt-yx2g"}))
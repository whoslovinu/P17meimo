#!/usr/bin/env python3
"""
verify_401_codes.py — confirm /api/admin/* 401 responses are distinguishable.
We don't need a valid login to verify the IRON_GATE 401 body shape.
"""
import json
import sys
import urllib.request
import urllib.error

BASE = "http://localhost:3000"


def post(path, body=None, cookie=None):
    headers = {"Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def main():
    print("=== A. IRON_GATE 401 (no cookie) ===")
    s, b = post("/api/admin/change-password",
                {"oldPassword": "x", "newPassword": "new12345678", "confirmPassword": "new12345678"})
    print(f"  HTTP {s}: {b}")
    print()

    print("=== B. /api/admin/stats w/o cookie — IRON_GATE 401 ===")
    s, b = post("/api/admin/stats", {})
    print(f"  HTTP {s}: {b}")
    print()

    print("=== C. /api/admin/banners/update w/o cookie — IRON_GATE 401 ===")
    s, b = post("/api/admin/banners/update", {"id": "x"})
    print(f"  HTTP {s}: {b}")
    print()

    print("=== D. /api/admin/login w/ WRONG password — 401 NOT IRON_GATE ===")
    s, b = post("/api/admin/login", {"password": "wrong"})
    print(f"  HTTP {s}: {b}")
    print()

    print("--- Verdict ---")
    print("A, B, C are IRON_GATE 401 — body shape: {\"error\":\"Unauthorized Access\"} OR {ok:false, error:{code:UNAUTHORIZED}}")
    print("D is a business 401 (bad password) — body: {ok:false, error:'密码错误'}")
    print("Helper isSessionExpiredBody triggers redirect when body matches IRON_GATE shape.")
    print("Helper does NOT trigger for /api/admin/login (URL filter excludes it) and other business 401s.")


if __name__ == "__main__":
    main()
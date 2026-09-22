#!/usr/bin/env python3
import json, subprocess, sys

ORIGIN = "http://localhost:3000"

# Use pycurl-like approach via subprocess
def curl(method, path, body=None, cookie=None):
    cmd = ["curl", "-s", "-X", method, f"http://localhost:3000{path}",
           "-H", "Content-Type: application/json",
           "-H", f"Origin: {ORIGIN}"]
    if cookie:
        cmd += ["-H", f"Cookie: {cookie}"]
    if body is not None:
        body_file = "/tmp/body.json"
        with open(body_file, "w") as f:
            json.dump(body, f, ensure_ascii=False)
        cmd += ["--data-binary", f"@{body_file}"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout

print("=== A. Wrong password (expect 401, server returns '密码错误') ===")
print(curl("POST", "/api/admin/login", {"password": "WRONG"}))

print("=== B. Correct password (expect ok:true) ===")
# This call needs to save cookie
import urllib.request, urllib.error
def post_save_cookie(path, body):
    req = urllib.request.Request(
        f"http://localhost:3000{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Origin": ORIGIN},
        method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode(), r.headers.get("Set-Cookie")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), None

s, b, sc = post_save_cookie("/api/admin/login", {"password": "giys-agjj-niqt-yx2g"})
print(f"  HTTP {s}: {b}")
if not sc:
    print("  ABORT — no cookie")
    sys.exit(1)
cookie = sc.split(";")[0]
print(f"  Cookie: {cookie[:40]}...")
print()

print("=== C. PUT activity/update with INVALID propA (sum=80%) ===")
body = {
    "id": 1, "name": "test", "start_time": "2026-01-01T00:00", "end_time": "2099-12-31T23:59",
    "config": {
        "isGlobalEnabled": True, "rules": "",
        "boss": {"totalHp": 100000, "currentHp": 100000},
        "items": {
            "propA": {"name": "闪电符文", "rows": [
                {"id": "r1", "minDamage": 1, "maxDamage": 3, "probability": 40},
                {"id": "r2", "minDamage": 4, "maxDamage": 5, "probability": 40},
            ], "taskThreshold": 100, "dailyLimit": 5},
            "propB": {"name": "潮汐晶石", "rows": [
                {"id": "r3", "minDamage": 1, "maxDamage": 3, "probability": 50},
                {"id": "r4", "minDamage": 4, "maxDamage": 5, "probability": 50},
            ], "taskThreshold": 100, "dailyLimit": 5},
        },
        "milestones": [],
        "spine": {"baseUrl": "/spine/assets", "forms": [],
                  "formThresholds": {"stage2": 75, "stage3": 50, "stage4": 25}},
    },
}
import urllib.request
def put(path, body, cookie):
    req = urllib.request.Request(
        f"http://localhost:3000{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Origin": ORIGIN, "Cookie": cookie},
        method="PUT")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

s, b = put("/api/admin/activity/update", body, cookie)
print(f"  HTTP {s}: {b}")
print()

print("=== D. PUT activity/update with INVALID time range ===")
body2 = dict(body)
body2["start_time"] = "2099-12-31T23:59"
body2["end_time"]   = "2026-01-01T00:00"
# fix propA sum to 100 first
body2["config"] = dict(body["config"])
body2["config"]["items"] = dict(body["config"]["items"])
body2["config"]["items"]["propA"] = {
    "name": "闪电符文",
    "rows": [
        {"id": "r1", "minDamage": 1, "maxDamage": 3, "probability": 50},
        {"id": "r2", "minDamage": 4, "maxDamage": 5, "probability": 50},
    ],
    "taskThreshold": 100, "dailyLimit": 5,
}
s, b = put("/api/admin/activity/update", body2, cookie)
print(f"  HTTP {s}: {b}")
print()

print("--- Verdict ---")
print("A: server: '密码错误' → client humanizer → '密码错误，请核对后重新输入'")
print("C: server should return PROBABILITY_SUM_INVALID → UI Toast: '保存失败：[闪电符文概率] ...'")
print("D: server should return INVALID_TIME_RANGE → UI Toast: '保存失败：[活动开始时间] ...'")
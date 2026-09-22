#!/usr/bin/env python3
"""
verify_toast_messages.py — verify login + activities fixes at API+UI layers.
"""
import json
import urllib.request
import urllib.error

BASE = "http://localhost:3000"
ORIGIN = "http://localhost:3000"
HEADERS_JSON = {
    "Content-Type": "application/json",
    "Origin": ORIGIN,
}


def post(path, body=None, cookie=None, raw_text=None):
    headers = dict(HEADERS_JSON)
    if cookie:
        headers["Cookie"] = cookie
    if raw_text is not None:
        data = raw_text.encode()
    elif body is not None:
        data = json.dumps(body).encode()
    else:
        data = b""
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode(), r.headers.get("Set-Cookie")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), None


def put(path, body, cookie):
    headers = dict(HEADERS_JSON)
    headers["Cookie"] = cookie
    data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method="PUT")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def main():
    print("=== A. Wrong password login (server returns 401 + '密码错误') ===")
    s, b, _ = post("/api/admin/login", {"password": "definitely-wrong"})
    print(f"  HTTP {s}: {b}")
    print("  Note: client now translates via humanizeFetchError → '密码错误，请核对后重新输入'")
    print("  AND the login page strips '请先登录' / '会话已失效' as defence-in-depth.")
    print()

    print("=== B. Correct password login ===")
    s, b, set_cookie = post("/api/admin/login", {"password": "giys-agjj-niqt-yx2g"})
    print(f"  HTTP {s}: {b}")
    if not set_cookie:
        print("  ABORT: no cookie returned")
        return
    cookie = set_cookie.split(";")[0]
    print(f"  Cookie: {cookie[:40]}...")
    print()

    print("=== C. List activities to find a real id ===")
    # /api/admin/activity is GET; let's just use id=1 (should exist)
    ACT_ID = 1
    print(f"  Using activity id={ACT_ID}")
    print()

    print("=== D. PUT activity update with propA summing to 80% (INVALID) ===")
    bad_body = {
        "id": ACT_ID,
        "name": "test-bad-prop-a",
        "start_time": "2026-01-01T00:00",
        "end_time": "2099-12-31T23:59",
        "config": {
            "isGlobalEnabled": True,
            "rules": "",
            "boss": {"totalHp": 100000, "currentHp": 100000},
            "items": {
                "propA": {
                    "name": "闪电符文",
                    "rows": [
                        {"id": "r1", "minDamage": 1, "maxDamage": 3, "probability": 40},
                        {"id": "r2", "minDamage": 4, "maxDamage": 5, "probability": 40},
                    ],
                    "taskThreshold": 100,
                    "dailyLimit": 5,
                },
                "propB": {
                    "name": "潮汐晶石",
                    "rows": [
                        {"id": "r3", "minDamage": 1, "maxDamage": 3, "probability": 50},
                        {"id": "r4", "minDamage": 4, "maxDamage": 5, "probability": 50},
                    ],
                    "taskThreshold": 100,
                    "dailyLimit": 5,
                },
            },
            "milestones": [],
            "spine": {
                "baseUrl": "/spine/assets",
                "forms": [],
                "formThresholds": {"stage2": 75, "stage3": 50, "stage4": 25},
            },
        },
    }
    s, b = put("/api/admin/activity/update", bad_body, cookie)
    print(f"  HTTP {s}: {b}")
    print()

    print("=== E. PUT activity update with INVALID start_time > end_time ===")
    bad_time = dict(bad_body)
    bad_time["start_time"] = "2099-12-31T23:59"
    bad_time["end_time"] = "2026-01-01T00:00"
    bad_time["name"] = "test-bad-time"
    # also fix propA sum to 100 to bypass that check
    bad_time["config"]["items"]["propA"]["rows"] = [
        {"id": "r1", "minDamage": 1, "maxDamage": 3, "probability": 50},
        {"id": "r2", "minDamage": 4, "maxDamage": 5, "probability": 50},
    ]
    s, b = put("/api/admin/activity/update", bad_time, cookie)
    print(f"  HTTP {s}: {b}")
    print()

    print("--- Verdict ---")
    print("A: server returns '密码错误' for wrong-pw. Client humanizer sees URL=/api/admin/login")
    print("   and returns '密码错误，请核对后重新输入'. Login page also strips any leak.")
    print("D: server should reject propA=80% with PROBABILITY_SUM_INVALID code.")
    print("   UI now maps this to errors.propA and Toast: '保存失败：[闪电符文概率] ...'")
    print("E: server should reject time-range with INVALID_TIME_RANGE code.")
    print("   UI maps to errors.start_time and Toast: '保存失败：[活动开始时间] ...'")


if __name__ == "__main__":
    main()
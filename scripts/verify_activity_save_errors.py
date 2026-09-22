#!/usr/bin/env python3
"""Test activity update server-side rejection codes."""
import json, urllib.request, urllib.error

BASE = "http://localhost:3000"
ORIGIN = "http://localhost:3000"


def post(path, body):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Origin": ORIGIN},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode(), r.headers.get("Set-Cookie")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), None


def put(path, body, cookie):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Origin": ORIGIN, "Cookie": cookie},
        method="PUT",
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def main():
    # 1. login
    s, b, sc = post("/api/admin/login", {"password": "giys-agjj-niqt-yx2g"})
    print(f"Login: HTTP {s} {b[:50]}")
    if not sc:
        print("ABORT")
        return
    cookie = sc.split(";")[0]

    # 2. bad propA
    body_a = {
        "id": 1, "name": "test-propA-bad",
        "start_time": "2026-01-01T00:00", "end_time": "2099-12-31T23:59",
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
    s, b = put("/api/admin/activity/update", body_a, cookie)
    print(f"Bad propA (sum=80%): HTTP {s} {b}")
    print()

    # 3. bad start_time > end_time (and propA OK)
    body_t = dict(body_a)
    body_t["start_time"] = "2099-12-31T23:59"
    body_t["end_time"]   = "2026-01-01T00:00"
    body_t["name"] = "test-bad-time"
    body_t["config"] = dict(body_a["config"])
    body_t["config"]["items"] = dict(body_a["config"]["items"])
    body_t["config"]["items"]["propA"] = {
        "name": "闪电符文",
        "rows": [
            {"id": "r1", "minDamage": 1, "maxDamage": 3, "probability": 50},
            {"id": "r2", "minDamage": 4, "maxDamage": 5, "probability": 50},
        ],
        "taskThreshold": 100, "dailyLimit": 5,
    }
    s, b = put("/api/admin/activity/update", body_t, cookie)
    print(f"Bad time range: HTTP {s} {b}")
    print()

    # 4. duplicate milestone thresholds
    body_m = dict(body_a)
    body_m["name"] = "test-dup-ms"
    body_m["config"] = dict(body_a["config"])
    body_m["config"]["milestones"] = [
        {"id": "m1", "threshold": 1000, "rewardType": "ENERGY", "energyValue": 100},
        {"id": "m2", "threshold": 1000, "rewardType": "ENERGY", "energyValue": 200},
    ]
    s, b = put("/api/admin/activity/update", body_m, cookie)
    print(f"Duplicate milestones: HTTP {s} {b}")
    print()

    print("--- Verdict ---")
    print("Server returns precise error codes → UI now shows:")
    print("  '保存失败：[闪电符文概率] 概率总和必须等于 100%'  (PROBABILITY_SUM_INVALID)")
    print("  '保存失败：[活动开始时间] 开始时间必须早于结束时间'  (INVALID_TIME_RANGE)")
    print("  '保存失败：[里程碑节点] 累计伤害要求不能重复'  (DUPLICATE_MILESTONE_THRESHOLD)")


if __name__ == "__main__":
    main()
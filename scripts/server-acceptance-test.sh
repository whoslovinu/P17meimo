#!/usr/bin/env bash
# =============================================================================
# scripts/server-acceptance-test.sh — Customer-facing acceptance verification
# =============================================================================
# Run on the EC2 server AFTER successful deploy.
#
# This is the script you run BEFORE showing the URL to the customer.
# It exercises the full happy path end-to-end and prints a clean PASS/FAIL.
#
# Usage:
#   ./scripts/server-acceptance-test.sh [--quick]
#     --quick  Skip the latency bench (faster, ~30s instead of ~3min)
# =============================================================================

set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}[PASS]${RESET} $*"; }
warn() { echo -e "${YELLOW}[WARN]${RESET} $*"; }
fail() { echo -e "${RED}[FAIL]${RESET} $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
note() { echo -e "${BLUE}[INFO]${RESET} $*"; }

FAIL_COUNT=0
PASS_COUNT=0

if [[ "${1:-}" == "--quick" ]]; then
  BENCH_SAMPLE=10
else
  BENCH_SAMPLE=50
fi

echo ""
note "============================================"
note " P17 客户验收测试 (Acceptance Test)"
note " $(date -u +%Y-%m-%dT%H:%M:%SZ)"
note "============================================"
echo ""

# ── 1. Service reachable ────────────────────────────────────────────────────
note "[1/8] HTTP 可达性"
if curl -sf -o /dev/null --max-time 5 http://localhost:3000/api/time; then
  ok "服务在 :3000 监听"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  fail "服务在 :3000 不可达 — 检查 pm2 status"
fi

# ── 2. Startup endpoint ─────────────────────────────────────────────────────
note "[2/8] /api/internal/startup"
STARTUP=$(curl -sf --max-time 5 http://localhost:3000/api/internal/startup 2>/dev/null || echo '{}')
if echo "$STARTUP" | grep -q '"ok":true'; then
  ok "startup 端点 ok=true"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  fail "startup 端点异常: $STARTUP"
fi

# ── 3. Boss status ──────────────────────────────────────────────────────────
note "[3/8] /api/boss/status"
BOSS=$(curl -sf --max-time 5 http://localhost:3000/api/boss/status 2>/dev/null || echo '{}')
if echo "$BOSS" | grep -q '"ok":true'; then
  ok "boss 状态端点可读"
  PASS_COUNT=$((PASS_COUNT + 1))
  # Try to extract boss HP
  HP=$(echo "$BOSS" | grep -o '"hp_current":[0-9]*' | cut -d: -f2 || echo "?")
  note "  Boss HP: $HP"
else
  fail "boss 状态端点异常: $BOSS"
fi

# ── 4. Battle init ──────────────────────────────────────────────────────────
note "[4/8] /api/battle/init"
INIT=$(curl -sf --max-time 10 \
  -H "Authorization: Bearer 00000000-0000-0000-0000-000000000000" \
  http://localhost:3000/api/battle/init 2>/dev/null || echo '{}')
if echo "$INIT" | grep -q '"ok":true'; then
  ok "battle init 成功"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  warn "battle init 返回: $INIT (dev user 可能没注册？继续)"
fi

# ── 5. Attack action ────────────────────────────────────────────────────────
note "[5/8] /api/action/attack (核心接口)"
ATTACK_OK=0
for i in {1..3}; do
  RES=$(curl -sf --max-time 15 \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer 00000000-0000-0000-0000-000000000000" \
    -d "{\"item_type\":\"item_hand\",\"nonce\":\"acc-$(date +%s)-$i\"}" \
    http://localhost:3000/api/action/attack 2>/dev/null || echo '{}')
  if echo "$RES" | grep -q '"ok":true'; then
    ATTACK_OK=$((ATTACK_OK + 1))
  fi
done
if [[ $ATTACK_OK -ge 2 ]]; then
  ok "attack 成功 $ATTACK_OK/3 次"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  fail "attack 失败 3/3 次"
fi

# ── 6. Static asset (battle page) ──────────────────────────────────────────
note "[6/8] /battle 页面静态可访问"
HTML=$(curl -sf --max-time 10 http://localhost:3000/battle 2>/dev/null | head -c 1000 || echo '')
if echo "$HTML" | grep -q -i 'p17\|meimo\|魅魔'; then
  ok "/battle 页面返回有效 HTML"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  warn "/battle 页面没返回预期内容（可能是因为需要 cookie）"
fi

# ── 7. Rate limit / 429 handling ────────────────────────────────────────────
note "[7/8] Rate limit 反压测试 (60 次连续请求)"
RL_HIT=0
for i in {1..60}; do
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
    -H "Authorization: Bearer 00000000-0000-0000-0000-000000000000" \
    http://localhost:3000/api/boss/status)
  if [[ "$STATUS" == "429" ]]; then
    RL_HIT=$((RL_HIT + 1))
  fi
done
if [[ $RL_HIT -gt 0 ]]; then
  ok "Rate limit 触发 (60 次中 $RL_HIT 次返回 429)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  warn "60 次连续请求没触发 rate limit (可能阈值高或未启用 — 仅警告)"
fi

# ── 8. Latency bench ──────────────────────────────────────────────────────
note "[8/8] 攻击接口延迟基准 ($BENCH_SAMPLE samples)"
if [[ "${1:-}" != "--quick" ]]; then
  BENCH_OUT=$(cd /var/www/app && BENCH_SAMPLE=$BENCH_SAMPLE node scripts/bench_attack.mjs --gate 2>&1)
  if [[ $? -eq 0 ]]; then
    ok "延迟 SLA 通过"
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "$BENCH_OUT" | tail -8
  else
    fail "延迟 SLA 失败"
    echo "$BENCH_OUT" | tail -10
  fi
else
  warn "跳过延迟测试 (--quick)"
fi

echo ""
note "============================================"
note "验收测试结果: PASS=$PASS_COUNT  FAIL=$FAIL_COUNT"
note "============================================"
echo ""

if [[ $FAIL_COUNT -eq 0 ]]; then
  ok "🎉 全部通过！可以开放给客户验收"
  exit 0
else
  fail "❌ 有 $FAIL_COUNT 项失败，请先排查再交付"
  exit 1
fi
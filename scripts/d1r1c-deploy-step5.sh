#!/bin/bash
# scripts/d1r1c-deploy-step5.sh — STEP 5: Normal production attack test

# Source production env to get DATABASE_URL
cd /var/www/app
set -a
. /var/www/app/.env.production
set +a

echo "═════════════════════════════════════════════════════════════"
echo "[STEP 5] Normal production attack test"
echo "═════════════════════════════════════════════════════════════"

# Test user — controlled, not customer data
TEST_USER_ID="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
TEST_USER_LABEL="d1r1c-test-user"

# Get current active activity
echo ""
echo "[STEP 5a] Current activity (admin):"
ACTIVE_ID=$(sudo -n -u postgres psql -At -d "$(echo $DATABASE_URL | sed -E 's|.*/([^?]+).*|\1|')" -c "
SELECT id FROM public.activities WHERE (config->>'isGlobalEnabled')::boolean = true LIMIT 1;
" 2>/dev/null || echo "")
echo "  ACTIVE_ID=$ACTIVE_ID"

if [ -z "$ACTIVE_ID" ]; then
  echo "  ⚠ No active activity — using activity_id=0 for global-only damage"
  ACTIVE_ID=0
fi

echo ""
echo "[STEP 5b] Ensure test user exists"
RESULT=$(sudo -n -u postgres psql -At -d "$(echo $DATABASE_URL | sed -E 's|.*/([^?]+).*|\1|')" <<EOF
INSERT INTO public.users (id, nickname, avatar)
VALUES ('$TEST_USER_ID', 'd1r1c-test', '🧪')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_inventory (user_id, item_hand_count, item_phallus_count, total_damage_dealt)
VALUES ('$TEST_USER_ID', 50, 50, 0)
ON CONFLICT (user_id) DO UPDATE SET
  item_hand_count = GREATEST(item_hand_count, 50),
  item_phallus_count = GREATEST(item_phallus_count, 50),
  updated_at = NOW();
INSERT INTO public.user_activity_stats (user_id, activity_id, total_damage)
VALUES ('$TEST_USER_ID', $ACTIVE_ID, 0)
ON CONFLICT (user_id, activity_id) DO UPDATE SET
  total_damage = public.user_activity_stats.total_damage,
  updated_at = NOW();
SELECT 'OK';
EOF
)
echo "  $RESULT"

# ── BASELINE ─────────────────────────────────────────────────────────────────
echo ""
echo "[STEP 5c] BASELINE state for $TEST_USER_ID"

BASELINE=$(sudo -n -u postgres psql -At -d "$(echo $DATABASE_URL | sed -E 's|.*/([^?]+).*|\1|')" <<EOF
\\set ON_ERROR_STOP off
SELECT json_build_object(
  'user_id', '$TEST_USER_ID',
  'activity_id', $ACTIVE_ID,
  'global_damage', (SELECT COALESCE(total_damage_dealt, 0) FROM public.user_inventory WHERE user_id = '$TEST_USER_ID'),
  'activity_damage', (SELECT COALESCE(total_damage, 0) FROM public.user_activity_stats WHERE user_id = '$TEST_USER_ID' AND activity_id = $ACTIVE_ID),
  'attack_log_count', (SELECT COUNT(*) FROM public.attack_logs WHERE user_id = '$TEST_USER_ID'),
  'attack_log_sum', (SELECT COALESCE(SUM(damage_dealt), 0) FROM public.attack_logs WHERE user_id = '$TEST_USER_ID'),
  'item_hand_count', (SELECT COALESCE(item_hand_count, 0) FROM public.user_inventory WHERE user_id = '$TEST_USER_ID'),
  'item_phallus_count', (SELECT COALESCE(item_phallus_count, 0) FROM public.user_inventory WHERE user_id = '$TEST_USER_ID'),
  'boss_hp_pg', (SELECT current_hp FROM public.boss_status WHERE boss_id = '00000000-0000-0000-0000-000000000001')
);
EOF
)
echo "$BASELINE"

G_BEFORE=$(echo "$BASELINE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['global_damage'])")
A_BEFORE=$(echo "$BASELINE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['activity_damage'])")
LOG_COUNT_BEFORE=$(echo "$BASELINE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['attack_log_count'])")
LOG_SUM_BEFORE=$(echo "$BASELINE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['attack_log_sum'])")
HP_BEFORE=$(echo "$BASELINE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['boss_hp_pg'])")
HAND_BEFORE=$(echo "$BASELINE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['item_hand_count'])")
PHALLUS_BEFORE=$(echo "$BASELINE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['item_phallus_count'])")

# Redis boss HP
REDIS_HP_BEFORE=$(sudo -n bash -c ". /var/www/app/.env.production && echo '$REDIS_URL'" | xargs -I {} redis-cli -u {} GET "battle:boss:hp" 2>/dev/null)
echo "  Redis boss HP: $REDIS_HP_BEFORE"

echo ""
echo "[STEP 5d] BASELINE recorded:"
echo "  global_damage(G)  = $G_BEFORE"
echo "  activity_damage(A)= $A_BEFORE"
echo "  attack_log_count(L)= $LOG_COUNT_BEFORE"
echo "  attack_log_sum(S) = $LOG_SUM_BEFORE"
echo "  boss_hp_pg(P)    = $HP_BEFORE"
echo "  boss_hp_redis(R) = $REDIS_HP_BEFORE"
echo "  item_hand(I_hand)= $HAND_BEFORE"
echo "  item_phallus(I_p)= $PHALLUS_BEFORE"

# ── EXECUTE ATTACK ───────────────────────────────────────────────────────────
echo ""
echo "[STEP 5e] Execute ONE legitimate attack via HTTP API"

NONCE="d1r1c-test-$(date +%s)-$RANDOM"
echo "  NONCE=$NONCE"

ATTACK_RESULT=$(curl -s -X POST http://127.0.0.1:3000/api/action/attack \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TEST_USER_ID" \
  -d "{\"item_type\":\"item_hand\",\"nonce\":\"$NONCE\"}")
echo "  Result: $ATTACK_RESULT"

DAMAGE=$(echo "$ATTACK_RESULT" | python3 -c "
import json,sys
try:
    d=json.loads(sys.stdin.read())
    if d.get('ok'):
        print(d['data']['actual_damage'])
    else:
        print('ERROR:'+str(d))
except Exception as e:
    print('PARSE_ERR:'+str(e))
")
echo "  Actual damage from response: $DAMAGE"

# ── POST STATE ───────────────────────────────────────────────────────────────
echo ""
echo "[STEP 5f] POST-attack state"

POST=$(sudo -n -u postgres psql -At -d "$(echo $DATABASE_URL | sed -E 's|.*/([^?]+).*|\1|')" <<EOF
\\set ON_ERROR_STOP off
SELECT json_build_object(
  'global_damage', (SELECT COALESCE(total_damage_dealt, 0) FROM public.user_inventory WHERE user_id = '$TEST_USER_ID'),
  'activity_damage', (SELECT COALESCE(total_damage, 0) FROM public.user_activity_stats WHERE user_id = '$TEST_USER_ID' AND activity_id = $ACTIVE_ID),
  'attack_log_count', (SELECT COUNT(*) FROM public.attack_logs WHERE user_id = '$TEST_USER_ID'),
  'attack_log_sum', (SELECT COALESCE(SUM(damage_dealt), 0) FROM public.attack_logs WHERE user_id = '$TEST_USER_ID'),
  'item_hand_count', (SELECT COALESCE(item_hand_count, 0) FROM public.user_inventory WHERE user_id = '$TEST_USER_ID'),
  'item_phallus_count', (SELECT COALESCE(item_phallus_count, 0) FROM public.user_inventory WHERE user_id = '$TEST_USER_ID'),
  'boss_hp_pg', (SELECT current_hp FROM public.boss_status WHERE boss_id = '00000000-0000-0000-0000-000000000001')
);
EOF
)
echo "$POST"

G_AFTER=$(echo "$POST" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['global_damage'])")
A_AFTER=$(echo "$POST" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['activity_damage'])")
LOG_COUNT_AFTER=$(echo "$POST" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['attack_log_count'])")
LOG_SUM_AFTER=$(echo "$POST" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['attack_log_sum'])")
HP_AFTER=$(echo "$POST" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['boss_hp_pg'])")
HAND_AFTER=$(echo "$POST" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['item_hand_count'])")
PHALLUS_AFTER=$(echo "$POST" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['item_phallus_count'])")

REDIS_HP_AFTER=$(sudo -n bash -c ". /var/www/app/.env.production && echo '$REDIS_URL'" | xargs -I {} redis-cli -u {} GET "battle:boss:hp" 2>/dev/null)
echo "  Redis boss HP: $REDIS_HP_AFTER"

# ── COMPUTE DELTAS ───────────────────────────────────────────────────────────
echo ""
echo "[STEP 5g] DELTAS"
G_DELTA=$(python3 -c "print(int($G_AFTER) - int($G_BEFORE))")
A_DELTA=$(python3 -c "print(int($A_AFTER) - int($A_BEFORE))")
LOG_COUNT_DELTA=$(python3 -c "print(int($LOG_COUNT_AFTER) - int($LOG_COUNT_BEFORE))")
LOG_SUM_DELTA=$(python3 -c "print(int($LOG_SUM_AFTER) - int($LOG_SUM_BEFORE))")
HP_DELTA=$(python3 -c "print(int($HP_AFTER) - int($HP_BEFORE))")
REDIS_HP_DELTA=$(python3 -c "print(int($REDIS_HP_AFTER) - int($REDIS_HP_BEFORE))")
HAND_DELTA=$(python3 -c "print(int($HAND_AFTER) - int($HAND_BEFORE))")
PHALLUS_DELTA=$(python3 -c "print(int($PHALLUS_AFTER) - int($PHALLUS_BEFORE))")

echo "  Global damage delta:      $G_DELTA  (expected = D = $DAMAGE)"
echo "  Activity damage delta:    $A_DELTA  (expected = D = $DAMAGE)"
echo "  Attack log count delta:   $LOG_COUNT_DELTA  (expected = 1)"
echo "  Attack log sum delta:     $LOG_SUM_DELTA  (expected = D = $DAMAGE)"
echo "  Boss HP (PG) delta:       $HP_DELTA  (expected = -D = -$DAMAGE)"
echo "  Boss HP (Redis) delta:    $REDIS_HP_DELTA  (expected = -D = -$DAMAGE)"
echo "  Item hand delta:          $HAND_DELTA  (expected = -1)"
echo "  Item phallus delta:       $PHALLUS_DELTA  (expected = 0)"

# Save results to file
cat > /tmp/d1r1c-step5.txt <<EOF
TEST_USER_ID=$TEST_USER_ID
ACTIVE_ID=$ACTIVE_ID
NONCE=$NONCE
DAMAGE=$DAMAGE
G_BEFORE=$G_BEFORE
G_AFTER=$G_AFTER
G_DELTA=$G_DELTA
A_BEFORE=$A_BEFORE
A_AFTER=$A_AFTER
A_DELTA=$A_DELTA
LOG_COUNT_BEFORE=$LOG_COUNT_BEFORE
LOG_COUNT_AFTER=$LOG_COUNT_AFTER
LOG_COUNT_DELTA=$LOG_COUNT_DELTA
LOG_SUM_BEFORE=$LOG_SUM_BEFORE
LOG_SUM_AFTER=$LOG_SUM_AFTER
LOG_SUM_DELTA=$LOG_SUM_DELTA
HP_BEFORE=$HP_BEFORE
HP_AFTER=$HP_AFTER
HP_DELTA=$HP_DELTA
REDIS_HP_BEFORE=$REDIS_HP_BEFORE
REDIS_HP_AFTER=$REDIS_HP_AFTER
REDIS_HP_DELTA=$REDIS_HP_DELTA
HAND_BEFORE=$HAND_BEFORE
HAND_AFTER=$HAND_AFTER
HAND_DELTA=$HAND_DELTA
PHALLUS_BEFORE=$PHALLUS_BEFORE
PHALLUS_AFTER=$PHALLUS_AFTER
PHALLUS_DELTA=$PHALLUS_DELTA
EOF
echo ""
echo "  Saved to /tmp/d1r1c-step5.txt"

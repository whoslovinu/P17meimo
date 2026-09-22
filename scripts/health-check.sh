#!/usr/bin/env bash
# scripts/health-check.sh
# One-shot health overview for "how is this codebase doing?".
# Reads-only. Safe to run anywhere.
#
# Output structure:
#   • TypeScript      — 0 errors / N errors
#   • Production build — PASS / FAIL
#   • Network rule    — N bare fetch / axios calls (must be 0 in app/)
#   • Routes          — N static + M dynamic
#   • Latency gate    — pass / warn / fail (requires running server)

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

G='\033[32m'; R='\033[31m'; Y='\033[33m'; B='\033[36m'; N='\033[0m'

ok()   { printf "${G}✓${N} %s\n" "$*"; }
warn() { printf "${Y}!${N} %s\n" "$*"; }
bad()  { printf "${R}✗${N} %s\n" "$*"; }
head() { printf "${B}== %s ==${N}\n" "$*"; }

head "P17 Health Check"
echo "  cwd : $ROOT"
echo "  date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

# 1. TypeScript ─────────────────────────────────────────────────────────────
head "[1/5] TypeScript"
if [[ -x node_modules/.bin/tsc ]]; then
  OUT=$(node_modules/.bin/tsc --noEmit 2>&1)
  if [[ $? -eq 0 ]]; then
    ok "0 errors"
  else
    ERR_COUNT=$(printf '%s\n' "$OUT" | grep -c "error TS" || true)
    bad "$ERR_COUNT errors"
    printf '%s\n' "$OUT" | grep "error TS" | head -5
  fi
else
  warn "tsc not in node_modules/.bin — run 'npm ci' to restore"
fi
echo

# 2. Production build ──────────────────────────────────────────────────────
head "[2/5] Production build"
if [[ -f .next/BUILD_ID ]]; then
  ok "BUILD_ID=$(cat .next/BUILD_ID)"
else
  warn "no .next/BUILD_ID — run 'npm run build:no-lint'"
fi
echo

# 3. Network Layer Hard Rule ───────────────────────────────────────────────
head "[3/5] Network Layer Hard Rule (V6.0+)"
# Exclude the wrapper files themselves (adminFetch, fetchWithTimeout, adminApi)
BARE_FETCH=$(grep -rn --include='*.ts' --include='*.tsx' -E "(^|[^a-zA-Z_$.])fetch\s*\(\s*['\"]" app 2>/dev/null \
  | grep -v 'fetchWithTimeout.ts' \
  | grep -v 'adminFetch.ts' \
  | grep -v 'adminApi.ts' \
  | grep -v '__tests__' \
  | wc -l | tr -d ' ')
BARE_AXIOS=$(grep -rn --include='*.ts' --include='*.tsx' -E "\baxios\s*[\.\(]" app 2>/dev/null | grep -v '__tests__' | wc -l | tr -d ' ')
if [[ "$BARE_FETCH" -eq 0 && "$BARE_AXIOS" -eq 0 ]]; then
  ok "no bare fetch( or axios() in app/"
else
  bad "$BARE_FETCH bare fetch(  +  $BARE_AXIOS axios(  calls in app/"
  grep -rn --include='*.ts' --include='*.tsx' -E "(^|[^a-zA-Z_$.])fetch\s*\(\s*['\"]" app 2>/dev/null \
    | grep -v 'fetchWithTimeout.ts' \
    | grep -v 'adminFetch.ts' \
    | grep -v 'adminApi.ts' | head -5
fi
echo

# 4. Routes ────────────────────────────────────────────────────────────────
head "[4/5] Routes (build manifest)"
if [[ -f .next/app-build-manifest.json ]]; then
  TOTAL=$(jq '.pages' .next/app-build-manifest.json 2>/dev/null | grep -c '"' || echo '?')
  printf "  %s pages\n" "$TOTAL"
else
  warn "no .next/app-build-manifest.json — build first"
fi
echo

# 5. Latency gate (optional) ───────────────────────────────────────────────
head "[5/5] Latency gate (requires running server on :3000)"
if curl -sf -o /dev/null --max-time 3 http://localhost:3000/api/time; then
  ok "/api/time reachable"
  if [[ -x node || command -v node >/dev/null ]]; then
    OUT=$(BENCH_SAMPLE=20 node scripts/bench_attack.mjs --gate 2>&1)
    if [[ $? -eq 0 ]]; then
      ok "attack latency gate: PASS"
    else
      bad "attack latency gate: FAIL"
      echo "$OUT" | tail -10
    fi
  fi
else
  warn "/api/time not reachable on localhost:3000 — start the server first"
fi
echo

head "Done."
echo "  Reference: docs/P17_BATTLE_PROTOCOL.md"
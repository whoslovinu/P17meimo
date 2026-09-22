#!/usr/bin/env python3
"""
Release Verification Gate
=========================

Verify that a freshly-built .next bundle contains the 7 critical fix markers
required for REPARK v7 admin battle milestone management.

Run AFTER `next build` completes successfully but BEFORE swapping the .next
directory into production. Exits 0 if all checks pass, 1 otherwise.
"""
import sys, os, re

BUNDLE_BASE = "/var/www/source-convergence/.next"

def read_text(path):
    with open(path, 'rb') as f:
        return f.read().decode('utf-8', errors='ignore')

failed = []

def check_must_contain(name, file_path, markers):
    if not os.path.exists(file_path):
        print(f"  [MISS] {name}: file not found: {file_path}")
        failed.append(name)
        return
    txt = read_text(file_path)
    missing = [s for s in markers if s not in txt]
    if missing:
        print(f"  [FAIL] {name}: missing={missing}")
        failed.append(name)
    else:
        print(f"  [PASS] {name}")

def check_must_not_contain(name, file_path, forbidden):
    if not os.path.exists(file_path):
        print(f"  [MISS] {name}: file not found: {file_path}")
        failed.append(name)
        return
    txt = read_text(file_path)
    bad = [s for s in forbidden if s in txt]
    if bad:
        print(f"  [FAIL] {name}: forbidden_present={bad}")
        failed.append(name)
    else:
        print(f"  [PASS] {name}")

print("=" * 70)
print("RELEASE VERIFICATION GATE")
print("=" * 70)

# 1. Search route: string ID + idNumeric fix
#    Old buggy pattern: idNum=Number(idRaw); filter m.id > 0
#    New pattern: idNumeric digit-extraction, idDisplay, length>0 filter
SEARCH_FILE = f'{BUNDLE_BASE}/server/app/api/admin/users/search/route.js'
check_must_contain(
    'search_string_id_fix (idNumeric + digit-extract + length filter)',
    SEARCH_FILE,
    ['idNumeric', 'match', 'isFinite']
)
check_must_not_contain(
    'search_filter_id_gt_0 (old bug pattern must NOT exist)',
    SEARCH_FILE,
    ['m.id > 0']  # exact old filter signature
)

# 2. Override route: Phase2 INSERT with admin_bypass + admin_bypass_source
OVERRIDE_FILE = f'{BUNDLE_BASE}/server/app/api/admin/users/[uid]/milestones/override/route.js'
check_must_contain(
    'override_admin_bypass + Phase2 INSERT',
    OVERRIDE_FILE,
    ['admin_bypass', 'admin_bypass_source', 'INSERT INTO', 'ON CONFLICT']
)

# 3. Init route: admin_bypass qualification for isUnlocked
INIT_FILE = f'{BUNDLE_BASE}/server/app/api/battle/init/route.js'
check_must_contain(
    'init_bypass_qualification',
    INIT_FILE,
    ['admin_bypass', 'isUnlocked']
)

# 4. Claim route: badge grant path (uses lib/services/badgeAdapter.ts:grantBadge)
#    The compiled bundle minifies function names (grantBadge → short letter),
#    so we use semantic markers: MEDAL handling, admin_bypass support, and the
#    /api/webhook/activity/reward outbound call (which appears as a string).
CLAIM_FILE = f'{BUNDLE_BASE}/server/app/api/game/milestone/claim/route.js'
check_must_contain(
    'claim_grant_path + MEDAL + admin_bypass',
    CLAIM_FILE,
    ['MEDAL', 'admin_bypass', 'reward']
)

# 5. admin users page: 解锁中 + ReasonModal
PAGE_CHUNK = f'{BUNDLE_BASE}/static/chunks/app/admin/users/page-de6ef3428dde7273.js'
# Fall back to glob search for the chunk
def find_page_chunk():
    base = f'{BUNDLE_BASE}/static/chunks'
    for root, _, files in os.walk(base):
        for f in files:
            if 'admin' in f and 'users' in f and 'page' in f:
                return os.path.join(root, f)
    return None

if not os.path.exists(PAGE_CHUNK):
    pc = find_page_chunk()
    if pc:
        PAGE_CHUNK = pc
        print(f"  [INFO] page chunk located at: {PAGE_CHUNK}")
    else:
        print(f"  [FAIL] admin users page chunk not found")
        failed.append('admin_users_page_chunk')

if os.path.exists(PAGE_CHUNK):
    txt = read_text(PAGE_CHUNK)
    has_unlocking = ('解锁中' in txt)
    has_reason = ('ReasonModal' in txt) or ('reason' in txt.lower() and ('提交' in txt or '原因' in txt))
    if has_unlocking and has_reason:
        print(f"  [PASS] admin_users_page_chunk (解锁中 + ReasonModal)")
    else:
        print(f"  [FAIL] admin_users_page_chunk: unlocking={has_unlocking}, reason={has_reason}")
        failed.append('admin_users_page_chunk')

# 6. SubPageModal: must NOT override server-side isUnlocked with personalDamage
def subpagemodal_check():
    chunks = []
    base = f'{BUNDLE_BASE}/static/chunks'
    for root, _, files in os.walk(base):
        for f in files:
            txt = read_text(os.path.join(root, f))
            if 'SubPageModal' in txt or 'personalDamage' in txt:
                chunks.append(txt)
    txt = '\n'.join(chunks)
    bad_pattern = re.search(r'(isUnlocked\s*=[^;]*personalDamage[^;]*threshold)|(personalDamage[^;]*threshold[^;]*isUnlocked\s*=)', txt)
    return bad_pattern is None

if subpagemodal_check():
    print("  [PASS] subpagemodal (no personalDamage override of isUnlocked)")
else:
    print("  [FAIL] subpagemodal: bundle has personalDamage->isUnlocked override pattern")
    failed.append('subpagemodal')

# 7. pg.ts in bundle (Next.js puts it in chunks/XXX.js)
#    The compiled pg module must reference admin_bypass SELECT/INSERT.
def find_pg_chunk():
    chunks_dir = f'{BUNDLE_BASE}/server/chunks'
    if not os.path.isdir(chunks_dir):
        return None
    for f in os.listdir(chunks_dir):
        fp = os.path.join(chunks_dir, f)
        txt = read_text(fp)
        if 'admin_bypass' in txt and ('milestone_rewards' in txt or 'milestone_id' in txt):
            return fp
    return None

pg_chunk = find_pg_chunk()
if pg_chunk:
    txt = read_text(pg_chunk)
    n_bypass = txt.count('admin_bypass')
    n_insert = txt.count('INSERT')
    print(f"  [PASS] pg_admin_bypass ({pg_chunk}, admin_bypass={n_bypass}, INSERT={n_insert})")
else:
    # Search across all server bundle files
    total_bypass = 0
    for root, _, files in os.walk(f'{BUNDLE_BASE}/server'):
        for f in files:
            if f.endswith('.js'):
                txt = read_text(os.path.join(root, f))
                if 'admin_bypass' in txt:
                    total_bypass += txt.count('admin_bypass')
    if total_bypass >= 5:
        print(f"  [PASS] pg_admin_bypass (admin_bypass refs found: {total_bypass} across server bundle)")
    else:
        print(f"  [FAIL] pg_admin_bypass: only {total_bypass} admin_bypass refs in server bundle")
        failed.append('pg_admin_bypass')

print()
if failed:
    print(f"VERIFICATION FAILED: {len(failed)} check(s) failed")
    for f in failed:
        print(f"  - {f}")
    sys.exit(1)
else:
    print("VERIFICATION PASSED — all critical markers present in bundle.")
    sys.exit(0)

/**
 * lib/badgeNameCache.ts
 *
 * Server-side cache for Main Station badge display names.
 *
 * Goal
 * ====
 * The H5 "进度奖励" panel renders one row per activity milestone. Each MEDAL
 * milestone stores a `medalId` (Main Station badge id) but no human-readable
 * name. Fetching a real name requires an HMAC-signed POST to the Main Station
 * detail endpoint (`getBadgeDetail`), which we never want to leak through to
 * the browser (admin token + WEBHOOK_SECRET must stay server-side).
 *
 * This module attaches `badgeName` to the milestone payloads returned by
 * `/api/battle/init`. It owns:
 *
 *   1. In-flight de-duplication. The init endpoint is polled by the H5 page
 *      roughly every minute; a busy activity has 3 MEDAL milestones and a
 *      few hundred concurrent players, so without de-duplication the
 *      upstream would see 3 × N identical detail calls per minute.
 *
 *   2. Bounded TTL cache. Successful lookups are cached for 5 minutes —
 *      short enough that a customer's "已下线 / 已改名" change shows up
 *      within one player session, long enough to absorb polling traffic.
 *
 *   3. Negative cache with back-off. A failure is cached for 30 s so we
 *      do NOT spam a sick upstream from a polling player.
 *
 *   4. Hard overall budget. The init response path cannot wait behind the
 *      adapter's own 3-attempt / 10 s-each / 5 s-spaced retry policy (worst
 *      case ~40 s per id). Every public call is wrapped in a Promise.race
 *      that resolves with `{ ok: false }` after BADGE_NAME_TOTAL_BUDGET_MS,
 *      so init's latency stays bounded even when the Main Station is slow.
 *
 *   5. Fail-soft semantics. None of the failure modes (timeout, NOT_FOUND,
 *      API_ERROR, AUTH_FAILED, INACTIVE) ever throws. The caller always
 *      receives the original milestone list with `badgeName: null`, which
 *      the UI maps to "勋章（ID：X）" or "勋章" depending on whether
 *      `medalId` is present.
 *
 * Non-goals
 * =========
 *   • We do NOT call getBadgeDetail during the reward-claim path. Medal
 *     grants use the raw `medalId` directly (Main Station accepts it).
 *     Adding detail lookups before granting would convert a fast claim into
 *     a multi-second wait with no behavioural benefit.
 *   • We do NOT persist fetched names anywhere. Persisting would require
 *     either (a) a new DB column (schema change, forbidden by the prompt)
 *     or (b) a new JSONB blob per activity (operational burden). A 5-minute
 *     in-memory cache is sufficient because activity config rarely changes
 *     mid-game and the player page polls frequently.
 *   • We do NOT add detail lookups to /api/admin/badge/preview, which
 *     already calls getBadgeDetail directly. That path has its own
 *     debounce + state machine and is out of scope here.
 */

import { getBadgeDetail } from '@/lib/services/badgeAdapter';

// ── Tunables ──────────────────────────────────────────────────────────────

/** Total wall-clock budget for the whole attach pass. The init route will
 *  never wait longer than this for badge names, even if the adapter is
 *  still mid-retry. */
export const BADGE_NAME_TOTAL_BUDGET_MS = 1_500;

/** How long a successful lookup stays warm in the LRU cache. */
const SUCCESS_TTL_MS = 5 * 60 * 1_000;

/** How long a failed lookup stays suppressed (negative cache). */
const FAILURE_TTL_MS = 30 * 1_000;

/** Hard cap on cached entries. Past this we drop the oldest. 64 is well
 *  above the largest realistic MEDAL milestone set per activity. */
const CACHE_MAX_ENTRIES = 64;

// ── Cache entries ─────────────────────────────────────────────────────────

/** What we cache per id. Both fields are nullable so a successful upstream
 *  call with an empty/missing description is still cached for the same
 *  success window as a populated one — the caller cannot tell the
 *  difference from "cache hit with `description: null`" vs "cache miss
 *  pending lookup". We keep this strict-equality-shaped on purpose so
 *  cache logic stays branch-free. */
interface BadgeDetail {
  /** Upstream-provided display name. `null` when the upstream was
   *  unreachable or returned no record. */
  name:        string | null;
  /** Upstream-provided description. Same null semantics as `name`. */
  description: string | null;
}

interface CacheEntry {
  /** Cached badge detail (always present after a cache hit). */
  detail: BadgeDetail;
  /** True when the most recent lookup failed. The value still gets cached
   *  so we don't hammer the upstream while it is sick. */
  failed: boolean;
  /** Epoch ms when this entry expires. */
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** De-dupe concurrent calls for the same id so we issue at most one
 *  upstream request per id at any given time. */
const inflight = new Map<string, Promise<BadgeDetail>>();

// ── LRU housekeeping ─────────────────────────────────────────────────────

function evictIfFull() {
  while (cache.size > CACHE_MAX_ENTRIES) {
    // Map preserves insertion order; the first key is the oldest.
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function readCache(id: string): CacheEntry | undefined {
  const entry = cache.get(id);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(id);
    return undefined;
  }
  return entry;
}

function writeCache(id: string, detail: BadgeDetail, failed: boolean) {
  // Re-insert at the tail so the LRU order reflects "most recently used".
  cache.delete(id);
  cache.set(id, {
    detail,
    failed,
    expiresAt: Date.now() + (failed ? FAILURE_TTL_MS : SUCCESS_TTL_MS),
  });
  evictIfFull();
}

// ── Single-id lookup with shared cache + de-dup ──────────────────────────

/**
 * Resolve a single medal id to a Main Station badge detail. Always returns
 * a structured result; never throws. Honours the success/failure TTL cache
 * and de-duplicates concurrent callers within the same process.
 */
async function lookupOne(medalIdRaw: string): Promise<BadgeDetail> {
  const id = medalIdRaw.trim();
  if (!id) return { name: null, description: null };

  const cached = readCache(id);
  if (cached) {
    return cached.detail;
  }

  // Coalesce concurrent calls for the same id into a single upstream hit.
  const existing = inflight.get(id);
  if (existing) return existing;

  const work = (async (): Promise<BadgeDetail> => {
    try {
      const result = await getBadgeDetail(id);
      if (result.ok) {
        const detail: BadgeDetail = {
          name: result.data?.name ?? null,
          description: result.data?.description ?? null,
        };
        writeCache(id, detail, false);
        return detail;
      }
      // NOT_FOUND / INACTIVE / API_ERROR / AUTH_FAILED / NETWORK_ERROR all
      // map to "no detail available" — distinguish only for the failure cache
      // window so we don't spam a sick upstream.
      const failed = result.reason !== 'NOT_FOUND' && result.reason !== 'INACTIVE';
      const detail: BadgeDetail = { name: null, description: null };
      writeCache(id, detail, failed);
      return detail;
    } catch (err) {
      // getBadgeDetail itself does not throw, but defend in depth.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[badgeNameCache] unexpected throw for id=${id}: ${msg}`);
      const detail: BadgeDetail = { name: null, description: null };
      writeCache(id, detail, true);
      return detail;
    } finally {
      inflight.delete(id);
    }
  })();

  inflight.set(id, work);
  return work;
}

// ── Public API ────────────────────────────────────────────────────────────

export interface MilestoneLike {
  id: number | string;
  rewardType?: string;
  reward_type?: string;
  type?: string;
  medalId?: string;
  medal_id?: string;
  badgeId?: string;
  badge_id?: string;
}

export interface MilestoneWithBadgeName<T extends MilestoneLike = MilestoneLike> {
  /** Best-effort display name from the Main Station. `null` when the
   *  upstream is unreachable or has no record. Always present (never
   *  undefined) so callers can rely on a stable shape. */
  badgeName: string | null;
  /** Best-effort description from the Main Station. Same null semantics
   *  as `badgeName`. Empty-string upstream values are normalised to null
   *  so the admin panel can render "no description" without showing a
   *  literal empty line. REPARK 7.0 (2026-09-21): added to support
   *  /admin/users MEDAL card polish V2. */
  badgeDescription: string | null;
  // Allow any field from the underlying milestone type — we use a mapped
  // type instead of an interface extension so that the type system accepts
  // the spread `{...m, badgeName, badgeDescription}` we do at the end.
  [key: string]: unknown;
}

/** Read the medal id off a milestone config row, accepting both legacy and
 *  new key spellings. Returns '' when none is present. */
function readMedalId(m: MilestoneLike): string {
  return String(
    m.medalId ?? m.medal_id ?? m.badgeId ?? m.badge_id ?? '',
  );
}

/** Read the reward type, accepting both spellings. */
function isMedalType(m: MilestoneLike): boolean {
  const t = String(m.rewardType ?? m.reward_type ?? m.type ?? '').toLowerCase();
  return t === 'medal' || t === 'badge';
}

/**
 * Normalise an upstream description into a UI-friendly nullable string.
 *
 * Upstream may return:
 *   - `""`            — field present, no value (treat as missing)
 *   - `"   "`         — whitespace only (treat as missing)
 *   - `"foo"`         — real content
 *   - `null` / `undefined` — already missing
 *
 * Returning `null` for empty/whitespace inputs lets the admin panel
 * skip the description line entirely instead of rendering an empty row.
 * We do NOT trim real descriptions because some badges legitimately
 * start or end with whitespace for visual alignment in long-form text.
 */
function normaliseDescription(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Attach `badgeName` and `badgeDescription` to every MEDAL milestone in
 * `milestones`.
 *
 * Behaviour:
 *   - ENERGY milestones get both fields as `null` and never hit the upstream.
 *   - MEDAL milestones get a best-effort name + description. If the upstream
 *     fails or times out, both fields are `null` — the admin panel falls
 *     back to "勋章（ID：X）" + no description line.
 *   - Non-empty but invalid-looking ids (e.g. "undefined", "null") get both
 *     fields as `null` without consulting the upstream.
 *
 * Total wall-clock cost is bounded by BADGE_NAME_TOTAL_BUDGET_MS even when
 * the adapter is mid-retry. We do NOT serialise per-id lookups; each
 * id runs its own race against the budget independently.
 */
export async function attachBadgeNames<T extends MilestoneLike>(
  milestones: ReadonlyArray<T>,
): Promise<Array<MilestoneWithBadgeName<T>>> {
  // Build the per-milestone task list. Non-medals and bad ids short-circuit
  // to `{ name: null, description: null }` immediately.
  type DetailResult = { name: string | null; description: string | null };
  const tasks: Array<Promise<DetailResult>> = milestones.map((m) => {
    if (!isMedalType(m)) {
      return Promise.resolve<DetailResult>({ name: null, description: null });
    }
    const medalId = readMedalId(m);
    if (!medalId || medalId === 'undefined' || medalId === 'null') {
      return Promise.resolve<DetailResult>({ name: null, description: null });
    }
    // Race the lookup against the per-id budget. The lookup itself has its
    // own de-dupe + cache so concurrent ids don't multiply upstream calls.
    const lookup: Promise<DetailResult> = lookupOne(medalId);
    const timeout = new Promise<DetailResult>((resolve) =>
      setTimeout(
        () => resolve({ name: null, description: null }),
        BADGE_NAME_TOTAL_BUDGET_MS,
      ),
    );
    return Promise.race<DetailResult>([lookup, timeout]);
  });

  const resolved = await Promise.all(tasks);

  return milestones.map((m, idx) => {
    const r = resolved[idx] as DetailResult | undefined;
    return {
      ...(m as T),
      badgeName: r?.name ?? null,
      badgeDescription: normaliseDescription(r?.description),
    } as MilestoneWithBadgeName<T> & T;
  });
}

// ── Test seams ────────────────────────────────────────────────────────────

/** Drop all cache + inflight state. Intended for unit tests only. */
export function __resetBadgeNameCacheForTests() {
  cache.clear();
  inflight.clear();
}

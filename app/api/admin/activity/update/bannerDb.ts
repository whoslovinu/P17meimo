/**
 * Banner Database Adapter — AWS RDS PostgreSQL (raw pg) Implementation
 *
 * REPLACES the previous Supabase JS client implementation. The Supabase
 * SaaS project at `ntjfmvjdewbhkydzdlhj.supabase.co` is DEAD and must
 * no longer be referenced. All banner data lives on AWS RDS accessed
 * via the local SSH tunnel (127.0.0.1:5433) through `pg.Pool`.
 *
 * Schema (mirrors aws_01_schema.sql and the legacy 05_banners_table.sql):
 *   public.banners(
 *     id            TEXT PRIMARY KEY,
 *     image_url     TEXT NOT NULL DEFAULT '',
 *     redirect_id   TEXT NOT NULL DEFAULT '',
 *     redirect_type TEXT NOT NULL DEFAULT 'none',
 *     is_active     BOOLEAN NOT NULL DEFAULT false,
 *     show_countdown BOOLEAN NOT NULL DEFAULT false,
 *     sort_order    INTEGER NOT NULL DEFAULT 0,
 *     created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   )
 *
 *   public.activities(
 *     id     SERIAL PRIMARY KEY,
 *     name   VARCHAR(50),
 *     type   VARCHAR(10),
 *     config JSONB
 *   )
 *   Banner global config is stored at activities.id = 999999 under
 *   config->'banner_global' = { isGlobalEnabled, isCarouselEnabled, carouselInterval }.
 *
 * Property mapping (frontend camelCase ↔ DB snake_case):
 *   id               ←→  id
 *   imageUrl         ←→  image_url
 *   targetActivityId ←→  redirect_id (string) + redirect_type ('activity'|'none')
 *   sortWeight       ←→  sort_order
 *   isEnabled        ←→  is_active
 *   showCountdown    ←→  show_countdown
 *   createdAt        ←→  created_at
 *
 * Graceful degradation:
 *   - ECONNREFUSED (tunnel down) or any DB connection error → returns
 *     safe empty defaults so the HomePage and admin panels render without crashing.
 *   - Silent fallback is ACCEPTABLE here because banners are non-critical UI
 *     (empty carousel is better than a 500 error on the whole page).
 */

import { z } from 'zod';
import { getPostgresPool } from '@/lib/db/postgres';

// ── Public Types (frontend contract) ─────────────────────────────────────────

export interface BannerItem {
  id: string;
  imageUrl: string;
  targetActivityId: string | null;
  activityName: string | null;
  sortWeight: number;
  isEnabled: boolean;
  showCountdown: boolean;
  activityStatus?: 'upcoming' | 'active' | 'ended';
  startTime?: string;
  endTime?: string;
  createdAt: string;
}

export interface BannerGlobalConfig {
  isGlobalEnabled: boolean;
  isCarouselEnabled: boolean;
  carouselInterval: number;
}

const DEFAULT_GLOBAL_CONFIG: BannerGlobalConfig = {
  isGlobalEnabled: false,
  isCarouselEnabled: true,
  carouselInterval: 5,
};

/** Zod-validated global config used by the update path. */
const BannerGlobalConfigUpdateSchema = z
  .object({
    isGlobalEnabled: z.boolean().optional(),
    isCarouselEnabled: z.boolean().optional(),
    carouselInterval: z.number().int().positive().max(60).optional(),
  })
  .strict();

/** Zod-validated BannerItem used by the upsert path. */
const BannerItemSchema = z.object({
  id: z.string().min(1).max(128),
  imageUrl: z.string().max(2048).default(''),
  targetActivityId: z.string().nullable(),
  sortWeight: z.number().int().min(0).max(1_000_000).default(0),
  isEnabled: z.boolean().default(false),
  showCountdown: z.boolean().default(false),
  createdAt: z.string().min(1),
});

// ── Constants ────────────────────────────────────────────────────────────────

/** System activity row that owns banner_global config. */
const BANNER_GLOBAL_ACTIVITY_ID = 999999;

// ── DB Row Type ──────────────────────────────────────────────────────────────

interface BannerRow {
  id: string;
  image_url: string;
  redirect_id: string;
  redirect_type: string;
  is_active: boolean;
  show_countdown: boolean;
  sort_order: number;
  created_at: Date | string;
}

// ── Row ↔ Domain Translation ─────────────────────────────────────────────────

function rowToBannerItem(row: BannerRow): BannerItem {
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString();
  return {
    id: row.id,
    imageUrl: row.image_url,
    targetActivityId: row.redirect_id && row.redirect_id.length > 0 ? row.redirect_id : null,
    sortWeight: row.sort_order,
    isEnabled: row.is_active,
    showCountdown: row.show_countdown,
    createdAt,
    activityName: null,
  };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * Lists ALL banners (admin view — no is_active filter).
 * Returns empty array on ECONNREFUSED (tunnel down) so the page renders cleanly.
 */
export async function listBanners(): Promise<BannerItem[]> {
  try {
    const pool = getPostgresPool();
    const result = await pool.query<BannerRow>(
      `SELECT id, image_url, redirect_id, redirect_type, is_active, show_countdown, sort_order, created_at
       FROM public.banners
       ORDER BY sort_order ASC, created_at DESC`
    );
    return result.rows.map(rowToBannerItem);
  } catch (err) {
    console.warn('[bannerDb] listBanners: DB unreachable (ECONNREFUSED?), returning [].', err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Lists ACTIVE banners (public H5 carousel).
 * Returns empty array on ECONNREFUSED so the homepage carousel degrades gracefully.
 */
export async function listActiveBanners(): Promise<BannerItem[]> {
  try {
    const pool = getPostgresPool();
    const result = await pool.query<BannerRow>(
      `SELECT id, image_url, redirect_id, redirect_type, is_active, show_countdown, sort_order, created_at
       FROM public.banners
       WHERE is_active = true
       ORDER BY sort_order ASC, created_at DESC`
    );
    return result.rows.map(rowToBannerItem);
  } catch (err) {
    console.warn('[bannerDb] listActiveBanners: DB unreachable, returning [].', err instanceof Error ? err.message : String(err));
    return [];
  }
}

/** Returns a single banner by id, or null if not found or DB unreachable. */
export async function getBannerById(id: string): Promise<BannerItem | null> {
  try {
    const pool = getPostgresPool();
    const result = await pool.query<BannerRow>(
      `SELECT id, image_url, redirect_id, redirect_type, is_active, show_countdown, sort_order, created_at
       FROM public.banners
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    if (result.rowCount === 0) return null;
    return rowToBannerItem(result.rows[0]);
  } catch (err) {
    console.warn('[bannerDb] getBannerById: DB unreachable, returning null.', err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Creates a new banner row. Returns the created item. Throws on DB error.
 */
export async function createBanner(
  input: Omit<BannerItem, 'id' | 'createdAt'>
): Promise<BannerItem> {
  const pool = getPostgresPool();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const targetId = input.targetActivityId ?? '';
  const redirectType = input.targetActivityId ? 'activity' : 'none';

  const result = await pool.query<BannerRow>(
    `INSERT INTO public.banners (
        id, image_url, redirect_id, redirect_type,
        is_active, show_countdown, sort_order, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id, image_url, redirect_id, redirect_type, is_active, show_countdown, sort_order, created_at`,
    [
      id,
      input.imageUrl ?? '',
      targetId,
      redirectType,
      Boolean(input.isEnabled),
      Boolean(input.showCountdown),
      Number(input.sortWeight ?? 0),
    ]
  );

  // Force the client-supplied createdAt to round-trip exactly
  void createdAt;
  if (result.rowCount === 0) {
    throw new Error('[bannerDb] createBanner: INSERT returned no row.');
  }
  return rowToBannerItem(result.rows[0]);
}

/**
 * Updates a banner by id. Returns the updated item, or null if no such row.
 * Throws on DB error.
 */
export async function updateBanner(
  id: string,
  updates: Partial<Omit<BannerItem, 'id' | 'createdAt'>>
): Promise<BannerItem | null> {
  const pool = getPostgresPool();

  // Build a strictly-typed SET clause with parameter indices.
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (updates.imageUrl !== undefined) {
    sets.push(`image_url = $${idx++}`);
    params.push(String(updates.imageUrl));
  }
  if (updates.targetActivityId !== undefined) {
    sets.push(`redirect_id = $${idx++}`);
    params.push(updates.targetActivityId ?? '');
    sets.push(`redirect_type = $${idx++}`);
    params.push(updates.targetActivityId ? 'activity' : 'none');
  }
  if (updates.sortWeight !== undefined) {
    sets.push(`sort_order = $${idx++}`);
    params.push(Number(updates.sortWeight));
  }
  if (updates.isEnabled !== undefined) {
    sets.push(`is_active = $${idx++}`);
    params.push(Boolean(updates.isEnabled));
  }
  if (updates.showCountdown !== undefined) {
    sets.push(`show_countdown = $${idx++}`);
    params.push(Boolean(updates.showCountdown));
  }

  if (sets.length === 0) {
    // No-op: nothing to update. Return current row.
    return await getBannerById(id);
  }

  params.push(id);
  const sql = `
    UPDATE public.banners
       SET ${sets.join(', ')}
     WHERE id = $${idx}
     RETURNING id, image_url, redirect_id, redirect_type, is_active, show_countdown, sort_order, created_at
  `;
  const result = await pool.query<BannerRow>(sql, params);
  if (result.rowCount === 0) return null;
  return rowToBannerItem(result.rows[0]);
}

/**
 * Deletes a banner by id. Returns true if a row was removed, false otherwise.
 * Throws on DB error.
 */
export async function deleteBanner(id: string): Promise<boolean> {
  const pool = getPostgresPool();
  const result = await pool.query(`DELETE FROM public.banners WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Atomic full-replace upsert:
 *   - Items already in DB: UPDATE
 *   - Items not in DB: INSERT with generated UUID
 *   - Items in DB but not in the incoming array: DELETE
 *
 * All operations run inside a single transaction. The COMMIT / ROLLBACK
 * boundary is the function return.
 *
 * @throws if any input item fails Zod validation OR the DB transaction
 *         fails. The route handler must catch and translate to 500.
 */
export async function upsertBannerItems(items: BannerItem[]): Promise<void> {
  // 1. Validate every item up-front. Throwing here short-circuits the
  //    transaction before we open it.
  const validItems: BannerItem[] = items.map((raw) => {
    const parsed = BannerItemSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `[bannerDb] upsertBannerItems: invalid banner item: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`
      );
    }
    return parsed.data as BannerItem;
  });

  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. Fetch existing IDs (for delete detection).
    const existingResult = await client.query<{ id: string }>(
      `SELECT id FROM public.banners`
    );
    const existingIds = new Set<string>(existingResult.rows.map((r: { id: string }) => r.id));
    const incomingIds = new Set<string>(validItems.map((b) => b.id));

    // 3. Delete removed items.
    const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
    if (toDelete.length > 0) {
      await client.query(
        `DELETE FROM public.banners WHERE id = ANY($1::text[])`,
        [toDelete]
      );
    }

    // 4. Upsert all incoming items in one statement.
    //    Items with a "new-" prefix are regenerated to real UUIDs.
    const rows = validItems.map((item) => {
      const id = item.id.startsWith('new-') ? crypto.randomUUID() : item.id;
      const targetId = item.targetActivityId ?? '';
      const redirectType = item.targetActivityId ? 'activity' : 'none';
      return {
        id,
        image_url: item.imageUrl ?? '',
        redirect_id: targetId,
        redirect_type: redirectType,
        is_active: Boolean(item.isEnabled),
        show_countdown: Boolean(item.showCountdown),
        sort_order: Number(item.sortWeight ?? 0),
      };
    });

    if (rows.length > 0) {
      // Build a multi-row UPSERT with positional parameters.
      //   $1..$N for the first row, $N+1.. for the second, etc.
      const columns = 6; // id, image_url, redirect_id, redirect_type, is_active, show_countdown, sort_order — actually 7
      const colCount = 7;
      const valueClauses: string[] = [];
      const params: unknown[] = [];
      rows.forEach((r, rowIdx) => {
        const base = rowIdx * colCount;
        valueClauses.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`
        );
        params.push(
          r.id,
          r.image_url,
          r.redirect_id,
          r.redirect_type,
          r.is_active,
          r.show_countdown,
          r.sort_order
        );
      });

      const sql = `
        INSERT INTO public.banners
          (id, image_url, redirect_id, redirect_type, is_active, show_countdown, sort_order)
        VALUES ${valueClauses.join(', ')}
        ON CONFLICT (id) DO UPDATE SET
          image_url      = EXCLUDED.image_url,
          redirect_id    = EXCLUDED.redirect_id,
          redirect_type  = EXCLUDED.redirect_type,
          is_active      = EXCLUDED.is_active,
          show_countdown = EXCLUDED.show_countdown,
          sort_order     = EXCLUDED.sort_order
      `;
      // P0 2026-07-30: diagnostic log — print first image_url so operator can see what's being persisted
      console.log(`[bannerDb] upsert ${rows.length} banner(s), first image_url: "${rows[0].image_url}"`);
      await client.query(sql, params);
    }

    await client.query('COMMIT');
    console.log(`[bannerDb] upsertBannerItems committed ${rows.length} row(s) successfully`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* swallow secondary rollback failure; surface the original error */
    });
    throw err;
  } finally {
    client.release();
  }
}

// ── Global Config ────────────────────────────────────────────────────────────

interface GlobalConfigRow {
  config: Record<string, unknown> | null;
}

/**
 * Reads the banner global config from the system activity row.
 * Returns DEFAULT_GLOBAL_CONFIG if DB is unreachable (ECONNREFUSED).
 */
export async function getGlobalConfig(): Promise<BannerGlobalConfig> {
  try {
    const pool = getPostgresPool();
    const result = await pool.query<GlobalConfigRow>(
      `SELECT config FROM public.activities WHERE id = $1 LIMIT 1`,
      [BANNER_GLOBAL_ACTIVITY_ID]
    );
    if (result.rowCount === 0 || !result.rows[0]?.config) {
      return { ...DEFAULT_GLOBAL_CONFIG };
    }
    const bg = (result.rows[0].config as Record<string, unknown>).banner_global as
      | Record<string, unknown>
      | undefined;
    if (!bg) return { ...DEFAULT_GLOBAL_CONFIG };

    return {
      isGlobalEnabled:
        typeof bg.isGlobalEnabled === 'boolean' ? bg.isGlobalEnabled : DEFAULT_GLOBAL_CONFIG.isGlobalEnabled,
      isCarouselEnabled:
        typeof bg.isCarouselEnabled === 'boolean'
          ? bg.isCarouselEnabled
          : DEFAULT_GLOBAL_CONFIG.isCarouselEnabled,
      carouselInterval:
        typeof bg.carouselInterval === 'number' && Number.isFinite(bg.carouselInterval)
          ? bg.carouselInterval
          : DEFAULT_GLOBAL_CONFIG.carouselInterval,
    };
  } catch (err) {
    console.warn('[bannerDb] getGlobalConfig: DB unreachable, returning defaults.', err instanceof Error ? err.message : String(err));
    return { ...DEFAULT_GLOBAL_CONFIG };
  }
}

/**
 * Updates the banner global config stored in activities.config->'banner_global'.
 * Throws on Zod validation failure OR on DB error. Returns the new merged config.
 *
 * Note: this function still returns a value (not void) for compatibility with
 * the previous Supabase implementation, but callers must NOT use a falsy
 * return value as a "no-op" signal — a DB failure now throws.
 */
export async function updateGlobalConfig(
  updates: Partial<BannerGlobalConfig>
): Promise<BannerGlobalConfig> {
  // 1. Validate input shape strictly.
  const parsed = BannerGlobalConfigUpdateSchema.safeParse(updates);
  if (!parsed.success) {
    throw new Error(
      `[bannerDb] updateGlobalConfig: invalid input: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
  }
  const safeUpdates = parsed.data;

  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. Lock the row for the duration of the merge to prevent lost-update.
    const readResult = await client.query<GlobalConfigRow>(
      `SELECT config FROM public.activities WHERE id = $1 FOR UPDATE`,
      [BANNER_GLOBAL_ACTIVITY_ID]
    );
    if (readResult.rowCount === 0) {
      // Bootstrap the system row on first write.
      await client.query(
        `INSERT INTO public.activities
           (id, name, type, start_time, end_time, status, config)
         VALUES ($1, '__banner_global__', 'LIVE2D', '2026-01-01T00:00:00Z', '2099-12-31T23:59:59Z', 'DISABLED', $2::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [
          BANNER_GLOBAL_ACTIVITY_ID,
          JSON.stringify({ banner_global: { ...DEFAULT_GLOBAL_CONFIG, ...safeUpdates } }),
        ]
      );
      await client.query('COMMIT');
      return { ...DEFAULT_GLOBAL_CONFIG, ...safeUpdates };
    }

    const currentConfig = (readResult.rows[0].config as Record<string, unknown>) ?? {};
    const currentBg = (currentConfig.banner_global as Record<string, unknown>) ?? {};
    const newBg: Record<string, unknown> = {
      isGlobalEnabled:
        safeUpdates.isGlobalEnabled !== undefined
          ? safeUpdates.isGlobalEnabled
          : (typeof currentBg.isGlobalEnabled === 'boolean'
              ? currentBg.isGlobalEnabled
              : DEFAULT_GLOBAL_CONFIG.isGlobalEnabled),
      isCarouselEnabled:
        safeUpdates.isCarouselEnabled !== undefined
          ? safeUpdates.isCarouselEnabled
          : (typeof currentBg.isCarouselEnabled === 'boolean'
              ? currentBg.isCarouselEnabled
              : DEFAULT_GLOBAL_CONFIG.isCarouselEnabled),
      carouselInterval:
        safeUpdates.carouselInterval !== undefined
          ? safeUpdates.carouselInterval
          : (typeof currentBg.carouselInterval === 'number'
              ? currentBg.carouselInterval
              : DEFAULT_GLOBAL_CONFIG.carouselInterval),
    };
    const newConfig = { ...currentConfig, banner_global: newBg };

    const updateResult = await client.query(
      `UPDATE public.activities
          SET config = $1::jsonb
        WHERE id = $2`,
      [JSON.stringify(newConfig), BANNER_GLOBAL_ACTIVITY_ID]
    );
    if ((updateResult.rowCount ?? 0) === 0) {
      throw new Error('[bannerDb] updateGlobalConfig: UPDATE matched no row.');
    }

    await client.query('COMMIT');
    return newBg as unknown as BannerGlobalConfig;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

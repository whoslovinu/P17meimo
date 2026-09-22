import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import {
  getBadgeById,
  updateBadge,
  isBadgeNameUnique,
  type BadgeUpdatePatch,
} from '@/lib/db/pg';

// GET /api/admin/badge/[id] — fetch a single active badge by ID.
//
// REPARK Phase 1 (2026-09-02): the previous implementation served hard-coded
// `placehold.co` mock data. It has been replaced with a real PostgreSQL query
// against `public.badges` (see migration 16_add_badges_table.sql).
//
// REPARK Phase 2 (2026-09-02): adds PUT for badge updates. The GET handler
// continues to filter `is_active=true` for backward compatibility with the
// MilestoneCard preview flow.
//
// Response shape preserved for MilestoneCard backward compatibility:
//   { ok: true,  data: { id, name, thumbnail } }
// `description` and `is_active` are added on top — older clients ignore them.
//
// Errors:
//   400 BAD_REQUEST — empty / malformed ID
//   404 NOT_FOUND   — no row matches (or the badge is_active=false)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdminAuth(_req);
  if (authError) return authError;

  const { id } = await params;
  const trimmed = id.trim();

  if (!trimmed) {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: '勋章 ID 不能为空' },
    }, { status: 400 });
  }

  let badge;
  try {
    badge = await getBadgeById(trimmed);
  } catch (err) {
    console.error('[admin/badge/[id]] DB error', err);
    return NextResponse.json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '勋章查询失败' },
    }, { status: 500 });
  }

  if (badge) {
    return NextResponse.json({ ok: true, data: badge });
  }

  // Unknown ID or soft-deleted (is_active=false) badge.
  // TC-AC-29: 404 for invalid badge so MilestoneCard can show the
  // "勋章 ID 不存在" red banner.
  return NextResponse.json({
    ok: false,
    error: { code: 'NOT_FOUND', message: '勋章 ID 不存在' },
  }, { status: 404 });
}

// PUT /api/admin/badge/[id] — partial update of an existing badge.
//
// REPARK Phase 2 (2026-09-02): admin badge CRUD.
//
// Body (any subset):
//   { name?, thumbnail?, description?, is_active? }
//
// The numeric ID is immutable (BIGSERIAL auto-assigned per Q2 decision).
// Activating/deactivating a badge via PUT is allowed; the dedicated
// /activate and /deactivate endpoints are sugar for clarity.
//
// Response 200: { ok: true, data: BadgeRow }
//
// Errors:
//   400 BAD_REQUEST — malformed ID / invalid field
//   404 NOT_FOUND   — no row with that ID (regardless of is_active)
//   409 CONFLICT    — name conflicts with another active badge
//   500 INTERNAL_ERROR
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  // ── 1. Parse + validate ID ──────────────────────────────────────────────
  const { id } = await params;
  const trimmed = id.trim();
  if (!trimmed) {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: '勋章 ID 不能为空' },
    }, { status: 400 });
  }
  const numericId = (() => {
    if (!/^-?\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && Number.isInteger(n) ? n : null;
  })();
  if (numericId === null) {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: '勋章 ID 必须是数字' },
    }, { status: 400 });
  }

  // ── 2. Parse body ───────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: '请求体必须是合法 JSON' },
    }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: '请求体格式错误' },
    }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;

  // Reject attempts to change the immutable id field.
  if ('id' in raw) {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: '勋章 ID 不可修改' },
    }, { status: 400 });
  }

  // ── 3. Build + validate patch ───────────────────────────────────────────
  const patch: BadgeUpdatePatch = {};

  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string') {
      return NextResponse.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'name 必须是字符串' },
      }, { status: 400 });
    }
    const trimmedName = raw.name.trim();
    if (!trimmedName) {
      return NextResponse.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: '勋章名称不能为空' },
      }, { status: 400 });
    }
    if (trimmedName.length > 40) {
      return NextResponse.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: '勋章名称不能超过 40 个字符' },
      }, { status: 400 });
    }
    patch.name = trimmedName;
  }

  if (raw.thumbnail !== undefined) {
    if (typeof raw.thumbnail !== 'string') {
      return NextResponse.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'thumbnail 必须是字符串' },
      }, { status: 400 });
    }
    const trimmedUrl = raw.thumbnail.trim();
    if (!trimmedUrl) {
      return NextResponse.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: '缩略图 URL 不能为空' },
      }, { status: 400 });
    }
    try {
      const parsed = new URL(trimmedUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('protocol');
      }
    } catch {
      return NextResponse.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: '缩略图必须是合法的 http(s) URL' },
      }, { status: 400 });
    }
    patch.thumbnail = trimmedUrl;
  }

  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') {
      return NextResponse.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'description 必须是字符串' },
      }, { status: 400 });
    }
    const trimmedDesc = raw.description.trim();
    if (trimmedDesc.length > 200) {
      return NextResponse.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: '描述不能超过 200 个字符' },
      }, { status: 400 });
    }
    patch.description = trimmedDesc;
  }

  if (raw.is_active !== undefined) {
    if (typeof raw.is_active !== 'boolean') {
      return NextResponse.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'is_active 必须是布尔值' },
      }, { status: 400 });
    }
    patch.is_active = raw.is_active;
  }

  // ── 4. Existence check (allow editing inactive rows) ────────────────────
  let existing;
  try {
    existing = await getBadgeById(numericId);
    // getBadgeById filters is_active=true — fall back to raw lookup if needed.
    if (!existing) {
      const pool = (await import('@/lib/db/postgres')).getPostgresPool();
      const res = await pool.query(
        'SELECT id FROM public.badges WHERE id = $1 LIMIT 1',
        [numericId]
      );
      if (res.rows.length === 0) {
        return NextResponse.json({
          ok: false,
          error: { code: 'NOT_FOUND', message: '勋章 ID 不存在' },
        }, { status: 404 });
      }
    }
  } catch (err) {
    console.error('[admin/badge/[id] PUT] DB lookup failed', err);
    return NextResponse.json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '勋章查询失败' },
    }, { status: 500 });
  }
  void existing; // existence already verified above

  // ── 5. Uniqueness check (only if name is changing) ───────────────────────
  if (patch.name !== undefined) {
    let unique: boolean;
    try {
      unique = await isBadgeNameUnique(patch.name, numericId);
    } catch (err) {
      console.error('[admin/badge/[id] PUT] DB uniqueness check failed', err);
      return NextResponse.json({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: '勋章唯一性检查失败' },
      }, { status: 500 });
    }
    if (!unique) {
      return NextResponse.json({
        ok: false,
        error: { code: 'CONFLICT', message: '勋章名称已被使用' },
      }, { status: 409 });
    }
  }

  // ── 6. Apply patch ───────────────────────────────────────────────────────
  let updated;
  try {
    updated = await updateBadge(numericId, patch);
  } catch (err) {
    console.error('[admin/badge/[id] PUT] DB update failed', err);
    return NextResponse.json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '勋章更新失败' },
    }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({
      ok: false,
      error: { code: 'NOT_FOUND', message: '勋章 ID 不存在' },
    }, { status: 404 });
  }

  return NextResponse.json({ ok: true, data: updated });
}

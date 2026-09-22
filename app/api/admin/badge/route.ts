import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { listBadges, createBadge, isBadgeNameUnique } from '@/lib/db/pg';

// GET /api/admin/badge — list all badges (active + inactive).
//
// REPARK Phase 1 (2026-09-02): Phase 1 scope is read-only listing.
// REPARK Phase 2 (2026-09-02): adds POST for badge creation.
//
// Response (GET):
//   { ok: true, data: [ { id, name, thumbnail, description, is_active, created_at, updated_at }, ... ] }
//
// Sort order: active first, then id ascending — matches `listBadges()` in
// lib/db/pg.ts so the listing endpoint stays a thin wrapper.
export async function GET(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  let badges;
  try {
    badges = await listBadges();
  } catch (err) {
    console.error('[admin/badge] DB error', err);
    return NextResponse.json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '勋章列表查询失败' },
    }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: badges });
}

// POST /api/admin/badge — create a new badge.
//
// REPARK Phase 2 (2026-09-02): admin badge CRUD.
//
// Body:
//   {
//     name:         string,  // required, 1-40 chars after trim
//     thumbnail:    string,  // required, valid URL (http/https)
//     description?: string,  // optional, ≤200 chars after trim
//     is_active?:   boolean  // optional, defaults to true
//   }
//
// Response 201:
//   { ok: true, data: BadgeRow }
//
// Errors:
//   400 BAD_REQUEST — missing/invalid field
//   409 CONFLICT    — name already in use by another active badge
//   500 INTERNAL_ERROR — DB failure
export async function POST(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  // ── 1. Parse body ───────────────────────────────────────────────────────
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
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const thumbnail = typeof raw.thumbnail === 'string' ? raw.thumbnail.trim() : '';
  const descriptionRaw = typeof raw.description === 'string' ? raw.description.trim() : '';
  const isActiveRaw = raw.is_active;

  // ── 2. Validate ─────────────────────────────────────────────────────────
  if (!name) {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: '勋章名称不能为空' },
    }, { status: 400 });
  }
  if (name.length > 40) {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: '勋章名称不能超过 40 个字符' },
    }, { status: 400 });
  }
  if (!thumbnail) {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: '缩略图 URL 不能为空' },
    }, { status: 400 });
  }
  try {
    const parsed = new URL(thumbnail);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('protocol');
    }
  } catch {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: '缩略图必须是合法的 http(s) URL' },
    }, { status: 400 });
  }
  if (descriptionRaw.length > 200) {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: '描述不能超过 200 个字符' },
    }, { status: 400 });
  }
  if (isActiveRaw !== undefined && typeof isActiveRaw !== 'boolean') {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'is_active 必须是布尔值' },
    }, { status: 400 });
  }

  // ── 3. Uniqueness check ─────────────────────────────────────────────────
  let unique: boolean;
  try {
    unique = await isBadgeNameUnique(name);
  } catch (err) {
    console.error('[admin/badge POST] DB uniqueness check failed', err);
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

  // ── 4. Insert ───────────────────────────────────────────────────────────
  let row;
  try {
    row = await createBadge({
      name,
      thumbnail,
      description: descriptionRaw,
      is_active: typeof isActiveRaw === 'boolean' ? isActiveRaw : true,
    });
  } catch (err) {
    console.error('[admin/badge POST] DB insert failed', err);
    return NextResponse.json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '勋章创建失败' },
    }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: row }, { status: 201 });
}

/**
 * app/api/admin/badge/preview/route.ts
 *
 * Phase A (2026-09-11): Badge ownership migration.
 *
 * REPARK 7.0 Commander Directive:
 *   "The customer's Main Station is now the single source of truth for badge metadata."
 *
 * This route is the ONLY authorized path for the admin UI to preview badge metadata.
 * It proxies BadgeAdapter.getBadgeDetail() — it NEVER touches the local public.badges
 * table. Badge metadata is read directly from the Main Station on every call.
 *
 * Stored in activity config: badge_id (string) only.
 * Preview: name, icon, description — live from Main Station.
 *
 * Route preserved for rollback (Phase B deferral).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBadgeDetail } from '@/lib/services/badgeAdapter';

/**
 * GET /api/admin/badge/preview?badge_id=10021
 *
 * Returns badge metadata from the Main Station Badge Detail API.
 *
 * Success (200):
 *   { ok: true, data: { badge_id, name, icon, description, status } }
 *
 * NOT_FOUND (200 + badge not in Main Station):
 *   { ok: false, reason: 'NOT_FOUND', message: '...' }
 *
 * INACTIVE (200 + badge exists but status !== 1):
 *   { ok: false, reason: 'INACTIVE', message: '...' }
 *
 * API_ERROR / NETWORK_ERROR (upstream unreachable):
 *   { ok: false, reason: 'API_ERROR'|'NETWORK_ERROR', message: '...' }
 *
 * INVALID_PARAM (400): badge_id missing or empty
 *   { ok: false, reason: 'INVALID_PARAM', message: '...' }
 *
 * CONFIG_ERROR (500): env vars MAIN_STATION_BADGE_DETAIL_URL not set
 *   { ok: false, reason: 'CONFIG_ERROR', message: '...' }
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const badgeId = searchParams.get('badge_id') ?? '';

  if (!badgeId || !badgeId.trim()) {
    return NextResponse.json(
      { ok: false, reason: 'INVALID_PARAM', message: 'badge_id query parameter is required' },
      { status: 400 },
    );
  }

  try {
    const result = await getBadgeDetail(badgeId.trim());

    if (result.ok) {
      return NextResponse.json({ ok: true, data: result.data });
    }

    // Map getBadgeDetail failure reasons to HTTP status codes.
    // NOT_FOUND / INACTIVE → 200 so the UI can display a friendly "not found"
    // or "inactive" banner without treating it as an error.
    // API_ERROR / NETWORK_ERROR → 502 Bad Gateway (upstream is unreachable).
    // AUTH_FAILED / INVALID_PARAM → 400.
    const httpStatus: Record<string, number> = {
      NOT_FOUND:      200,
      INACTIVE:       200,
      API_ERROR:      502,
      NETWORK_ERROR:  502,
      AUTH_FAILED:    400,
      INVALID_PARAM:  400,
    };

    return NextResponse.json(
      { ok: false, reason: result.reason, message: result.message },
      { status: httpStatus[result.reason] ?? 500 },
    );
  } catch (err) {
    // CONFIG_ERROR from requiredEnv() surfaces as a top-level throw before
    // getBadgeDetail is even called. Return 500 so operators know the
    // env vars are misconfigured.
    console.error('[BadgeAdapter/preview] FATAL:', err);
    return NextResponse.json(
      {
        ok: false,
        reason: 'CONFIG_ERROR',
        message: err instanceof Error ? err.message : 'Badge adapter failed to initialize. Check MAIN_STATION_BADGE_DETAIL_URL.',
      },
      { status: 500 },
    );
  }
}

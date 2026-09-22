/**
 * POST /api/admin/activity/set-active
 *
 * Sets exactly one activity as globally active.
 * Migrated from Supabase + JSON file → AWS RDS via lib/db/activitiesPg.ts.
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { setActivityActive } from '../update/db';

export async function POST(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const idParam = searchParams.get('id');

  if (!idParam || Number.isNaN(Number(idParam))) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Activity id (integer) is required as query param: ?id=',
        },
      },
      { status: 400 }
    );
  }

  const id = Number(idParam);

  try {
    const updated = await setActivityActive(id);
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Activity not found' } },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    console.error('[ADMIN/ACTIVITY] set-active error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      },
      { status: 500 }
    );
  }
}
/**
 * GET  /api/admin/activity — list all activities
 * POST /api/admin/activity — create a new activity
 *
 * Migrated from Supabase + JSON file → AWS RDS via lib/db/activitiesPg.ts.
 * Single code path: same DB call regardless of NODE_ENV.
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import {
  listActivities,
  createActivity,
  type Activity,
} from './update/db';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
} as const;

export async function GET(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  try {
    const data = await listActivities();
    return NextResponse.json(
      { ok: true, data },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (err) {
    console.error('[ADMIN/ACTIVITY] GET error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'QUERY_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}

export async function POST(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  let body: { name?: string; type?: string; start_time?: string; end_time?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  if (!body.name || !body.type || !body.start_time || !body.end_time) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Missing required fields: name, type, start_time, end_time',
        },
      },
      { status: 400 }
    );
  }
  if (body.name.length > 50) {
    return NextResponse.json(
      { ok: false, error: { code: 'NAME_TOO_LONG', message: 'Activity name must be 50 characters or fewer' } },
      { status: 400 }
    );
  }
  if (body.type !== 'LIVE2D' && body.type !== 'ENERGY') {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'type must be LIVE2D or ENERGY' } },
      { status: 400 }
    );
  }
  if (new Date(body.start_time) >= new Date(body.end_time)) {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Start time must be before end time' } },
      { status: 400 }
    );
  }

  try {
    const created: Activity = await createActivity({
      name: body.name.trim(),
      type: body.type as 'LIVE2D' | 'ENERGY',
      start_time: body.start_time,
      end_time: body.end_time,
    });
    return NextResponse.json({ ok: true, data: created });
  } catch (err) {
    console.error('[ADMIN/ACTIVITY] POST error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INSERT_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 }
    );
  }
}
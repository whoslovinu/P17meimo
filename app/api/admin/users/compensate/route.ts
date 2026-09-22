/**
 * POST /api/admin/users/compensate — Force-grant a milestone reward (audit)
 *
 * FIXes TC-UM-04 (unlock), TC-UM-12 (H5 claimable), LB-06 (audit trail).
 * Body: { userId: string; milestoneId: string }
 *
 * Security: Auth is enforced by requireAdminAuth (HMAC cookie check).
 * The internal proxy to /milestone is same-origin — Next.js forwards
 * the admin_token cookie automatically, so no x-admin-secret header needed.
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';

export async function POST(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  let body: { userId?: string; milestoneId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  const { userId, milestoneId } = body;

  if (!userId || typeof userId !== 'string') {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'userId is required' } },
      { status: 400 }
    );
  }

  if (!milestoneId || typeof milestoneId !== 'string') {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'milestoneId is required' } },
      { status: 400 }
    );
  }

  // Proxy to the canonical milestone route (same-origin — cookie forwarded automatically).
  //
  // FIX H-9: Validate and coerce milestoneId to a positive integer BEFORE
  // proxying. The downstream route uses z.number().int().positive(); if a
  // client sent a string here we used to forward it as-is and the proxy
  // would 400 the operator with no useful feedback. Now we 400 early with
  // a clear message, and we strip non-numeric forms like "m_5" so legacy
  // keys from the UI still work.
  const numericMilestoneId = Number(milestoneId);
  if (!Number.isInteger(numericMilestoneId) || numericMilestoneId <= 0) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: `milestoneId must be a positive integer (received: ${JSON.stringify(milestoneId)})`,
        },
      },
      { status: 400 }
    );
  }

  const milestoneRes = await fetch(new URL(req.url).origin + '/api/admin/users/milestone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'unlock',
      userId,
      milestoneId: numericMilestoneId,
    }),
  });

  const milestoneData = await milestoneRes.json();
  return NextResponse.json(milestoneData, { status: milestoneRes.status });
}

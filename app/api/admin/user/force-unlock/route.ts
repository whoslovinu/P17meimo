/**
 * POST /api/admin/users/force-unlock — Legacy proxy to /milestone
 *
 * DEPRECATED: Use /api/admin/users/milestone instead.
 * This route is kept for backward compatibility with existing callers.
 * It proxies to the milestone route with action=unlock.
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

  const body = await req.json().catch(() => null);
  if (!body?.userId || body?.milestoneId === undefined) {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'Missing userId or milestoneId' }
    }, { status: 400 });
  }

  // Proxy to the canonical milestone route (same-origin — cookie forwarded automatically)
  const milestoneRes = await fetch(new URL(req.url).origin + '/api/admin/users/milestone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'unlock',
      userId: body.userId,
      milestoneId: body.milestoneId,
    }),
  });

  const milestoneData = await milestoneRes.json();
  return NextResponse.json(milestoneData, { status: milestoneRes.status });
}

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireAdminAuth } from '@/app/lib/adminAuth';

/**
 * POST /api/admin/logout
 *
 * Clears the `admin_token` HttpOnly cookie to end the admin session.
 */
export async function POST(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const ADMIN_COOKIE = 'admin_token';

  try {
    const cookieStore = await cookies();
    cookieStore.delete(ADMIN_COOKIE);

    console.log('[ADMIN_LOGOUT] Session cleared.');
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[ADMIN_LOGOUT] Error:', error);
    return NextResponse.json(
      { ok: false, error: '服务器内部错误' },
      { status: 500 }
    );
  }
}

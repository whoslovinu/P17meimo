import { NextResponse } from 'next/server';
import { listBanners, getGlobalConfig } from '@/app/api/admin/activity/update/bannerDb';
import { requireAdminAuth } from '@/app/lib/adminAuth';

// GET /api/admin/banners — list all banners + global config.
//
// REPARK rule: any DB failure surfaces as HTTP 500 with `ok: false`.
// The previous Supabase implementation silently returned `{ ok: true, items: [] }`
// on a connection failure — that lie is what the Commander ordered us to kill.
export async function GET(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  let items;
  try {
    items = await listBanners();
  } catch (err: unknown) {
    const detail = err instanceof Error
      ? { name: (err as any).code ?? 'UNKNOWN', message: err.message, stack: err.stack }
      : String(err);
    console.error('[BANNER:ADMIN:GET] listBanners failed:', detail);
    return NextResponse.json(
      { ok: false, error: { code: 'DB_READ_FAILED', message: 'Failed to read banners', detail } },
      { status: 500 }
    );
  }

  let global;
  try {
    global = await getGlobalConfig();
  } catch (err: unknown) {
    const detail = err instanceof Error
      ? { name: (err as any).code ?? 'UNKNOWN', message: err.message, stack: err.stack }
      : String(err);
    console.error('[BANNER:ADMIN:GET] getGlobalConfig failed:', detail);
    return NextResponse.json(
      { ok: false, error: { code: 'DB_READ_FAILED', message: 'Failed to read global config', detail } },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { ok: true, items, global },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
      },
    }
  );
}

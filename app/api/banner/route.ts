import { NextResponse } from 'next/server';
import { listActiveBanners } from '@/app/api/admin/activity/update/bannerDb';

// GET /api/banner — public H5 banner carousel feed (active banners only).
//
// REPARK rule: a DB failure MUST surface as HTTP 500. The previous
// implementation returned `{ ok: true, data: [] }` when Supabase was
// unreachable, which silently broke the carousel. That lie is gone.
export async function GET() {
  try {
    const items = await listActiveBanners();
    return NextResponse.json(
      { ok: true, data: items },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
        },
      }
    );
  } catch (err) {
    console.error('[PUBLIC_BANNER:GET] listActiveBanners failed:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'DB_READ_FAILED',
          message: 'Banner service temporarily unavailable',
        },
      },
      { status: 500 }
    );
  }
}

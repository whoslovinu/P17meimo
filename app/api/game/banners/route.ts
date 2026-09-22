/**
 * GET /api/game/banners — public endpoint for H5 home page.
 *
 * Migrated from Supabase → AWS RDS via lib/db/activitiesPg.ts bannerDb.
 */

import { NextResponse } from 'next/server';
import { listActiveBanners, getGlobalConfig } from '@/app/api/admin/activity/update/bannerDb';

export async function GET() {
  try {
    const [banners, globalConfig] = await Promise.all([
      listActiveBanners(),
      getGlobalConfig(),
    ]);

    // TC-AB-01: global switch off → return empty
    if (!globalConfig.isGlobalEnabled) {
      return NextResponse.json({
        ok: true,
        data: [],
        config: { isCarouselEnabled: false, carouselInterval: 5 },
      });
    }

    // Resolve activity names + time boundaries for each banner via parallel lookups.
    const { getPostgresPool } = await import('@/lib/db/postgres');
    const pool = getPostgresPool();

    const enriched = await Promise.all(
      banners.map(async (banner) => {
        let activityName: string | null = banner.activityName ?? null;
        let startTime: string | undefined;
        let endTime: string | undefined;
        if (banner.targetActivityId) {
          const numId = Number(banner.targetActivityId);
          if (!Number.isNaN(numId)) {
            try {
              const result = await pool.query<{
                name: string;
                start_time: string;
                end_time: string;
              }>(
                `SELECT name, start_time, end_time
                   FROM public.activities
                  WHERE id = $1
                  LIMIT 1`,
                [numId]
              );
              const act = result.rows[0];
              if (act) {
                activityName = act.name;
                startTime = act.start_time;
                endTime = act.end_time;
              }
            } catch (err) {
              console.warn('[GAME:BANNERS:GET] activity lookup failed', err);
            }
          }
        }
        return {
          id: banner.id,
          // P0 2026-07-30: /uploads/<path> → /api/uploads/<path> so the dynamic
          // route (app/api/uploads/[...path]/route.ts) streams the file in production.
          imageUrl: banner.imageUrl
            ? banner.imageUrl.replace(/\?t=\d+$/, '').replace(/^\/uploads\//, '/api/uploads/')
            : banner.imageUrl,
          targetActivityId: banner.targetActivityId,
          activityName,
          sortWeight: banner.sortWeight,
          isEnabled: banner.isEnabled,
          showCountdown: banner.showCountdown,
          startTime,
          endTime,
          createdAt: banner.createdAt,
        };
      })
    );

    const carouselEnabled =
      globalConfig.isCarouselEnabled && enriched.length > 1;

    return NextResponse.json({
      ok: true,
      data: enriched,
      config: {
        isCarouselEnabled: carouselEnabled,
        carouselInterval: globalConfig.carouselInterval,
      },
    });
  } catch (err) {
    console.error('[GAME:BANNERS:GET] Fatal error:', err);
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
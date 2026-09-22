import { NextResponse } from 'next/server';
import { listActivities } from '@/app/api/admin/activity/update/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/game/init
 *
 * Public endpoint for the H5 frontend.
 * Finds the ONE currently-enabled activity (isGlobalEnabled === true) and
 * returns a sanitized payload with boss HP and spine config.
 *
 * Exposes ONLY what the frontend needs — no admin secrets.
 */

interface GameInitResponse {
  ok: true;
  data: {
    activityName:  string;
    /** Base URL for Spine assets, e.g. '/spine/assets' or a CDN URL */
    spineBaseUrl: string;
    /** Stage unlock thresholds (HP %) */
    formThresholds: {
      stage2: number;
      stage3: number;
      stage4: number;
    };
    boss: {
      totalHp:   number;
      currentHp: number;
    };
    /** Item damage distributions per weapon type */
    items: {
      propA: {
        name:          string;
        rows:          Array<{ minDamage: number; maxDamage: number; probability: number }>;
        taskThreshold: number;
        dailyLimit:   number;
      };
      propB: {
        name:          string;
        rows:          Array<{ minDamage: number; maxDamage: number; probability: number }>;
        taskThreshold: number;
        dailyLimit:   number;
      };
    };
    /** Milestone thresholds and reward definitions */
    milestones: Array<{
      id:         string;
      threshold:  number;
      rewardType: 'ENERGY' | 'MEDAL';
      energyValue?: number;
      medalId?:   string;
    }>;
  };
}

interface GameInitError {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export async function GET(): Promise<NextResponse<GameInitResponse | GameInitError>> {
  try {
    const activities = await listActivities();

    const active = activities.find((a) => a.config.isGlobalEnabled);

    if (!active) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code:    'ACTIVITY_OFFLINE',
            message: '当前没有正在运行的活动，请稍后再试。',
          },
        },
        { status: 200 },
      );
    }

    const cfg = active.config;

    const payload: GameInitResponse = {
      ok: true,
      data: {
        activityName:  active.name,
        spineBaseUrl: cfg.spine?.baseUrl        ?? '/spine/assets',
        formThresholds: {
          stage2: cfg.spine?.formThresholds?.stage2 ?? 75,
          stage3: cfg.spine?.formThresholds?.stage3 ?? 50,
          stage4: cfg.spine?.formThresholds?.stage4 ?? 25,
        },
        boss: {
          totalHp:   cfg.boss?.totalHp   ?? 100000,
          currentHp: cfg.boss?.currentHp ?? 100000,
        },
        items: {
          propA: cfg.items?.propA ?? { name: '闪电符文', rows: [{ minDamage: 1, maxDamage: 3, probability: 50 }, { minDamage: 4, maxDamage: 5, probability: 50 }], taskThreshold: 100, dailyLimit: 5 },
          propB: cfg.items?.propB ?? { name: '潮汐晶石', rows: [{ minDamage: 1, maxDamage: 3, probability: 50 }, { minDamage: 4, maxDamage: 5, probability: 50 }], taskThreshold: 100, dailyLimit: 5 },
        },
        milestones: cfg.milestones ?? [],
      },
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error('[game/init] Unexpected error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code:    'INTERNAL_ERROR',
          message: '服务器内部错误，请稍后再试。',
        },
      },
      { status: 500 },
    );
  }
}

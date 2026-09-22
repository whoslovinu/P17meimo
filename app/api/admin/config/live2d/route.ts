/**
 * /api/admin/config/live2d — get / persist Live2D model + stage thresholds.
 *
 * FIX H-3: previous version logged to stdout and returned { ok: true } — all
 * saves were discarded. Same Redis + PostgreSQL backing as `/spine`.
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getRedisClient, REDIS_KEYS } from '@/lib/redis';
import { getPostgresPool } from '@/lib/db/postgres';
import { z } from 'zod';

const Live2dPayloadSchema = z.object({
  modelZipUrl:      z.string().url().max(2048).optional(),
  bgStage1:         z.string().max(2048).optional(),
  bgStage2:         z.string().max(2048).optional(),
  stage1Threshold:  z.number().int().min(0).max(100).optional(),
  stage2Threshold:  z.number().int().min(0).max(100).optional(),
  stage3Threshold:  z.number().int().min(0).max(100).optional(),
});

const LIVE2D_CONFIG_PERSIST_TTL = 60 * 60 * 24 * 30;

interface Live2dConfig {
  modelZipUrl:      string;
  bgStage1:         string;
  bgStage2:         string;
  stage1Threshold:  number;
  stage2Threshold:  number;
  stage3Threshold:  number;
  updatedAt?:       string;
}

const DEFAULT_LIVE2D_CONFIG: Live2dConfig = {
  modelZipUrl: '/spine/meimo-model.zip',
  bgStage1:    '/bg-stage1.png',
  bgStage2:    '/bg-stage2.png',
  stage1Threshold: 75,
  stage2Threshold: 50,
  stage3Threshold: 25,
};

async function loadLive2dConfig(): Promise<Live2dConfig> {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(REDIS_KEYS.LIVE2D_CONFIG);
    if (raw) {
      return { ...DEFAULT_LIVE2D_CONFIG, ...(JSON.parse(raw) as Partial<Live2dConfig>) };
    }
  } catch (err) {
    console.warn('[ADMIN] Redis read for live2d config failed:', err);
  }

  try {
    const pool = getPostgresPool();
    const row = await pool.query<{ config_json: string | null }>(
      `SELECT config_json FROM public.repark_config WHERE key = $1 LIMIT 1`,
      ['live2d']
    );
    if (row.rows[0]?.config_json) {
      return { ...DEFAULT_LIVE2D_CONFIG, ...(JSON.parse(row.rows[0].config_json) as Partial<Live2dConfig>) };
    }
  } catch (err) {
    console.warn('[ADMIN] PostgreSQL read for live2d config failed:', err);
  }

  return DEFAULT_LIVE2D_CONFIG;
}

async function saveLive2dConfig(config: Live2dConfig): Promise<void> {
  const serialized = JSON.stringify(config);

  try {
    const redis = getRedisClient();
    await redis.set(REDIS_KEYS.LIVE2D_CONFIG, serialized, 'EX', LIVE2D_CONFIG_PERSIST_TTL);
  } catch (err) {
    console.error('[ADMIN] Redis write for live2d config failed:', err);
    throw err;
  }

  try {
    const pool = getPostgresPool();
    await pool.query(
      `INSERT INTO public.repark_config (key, config_json, updated_at)
       VALUES ('live2d', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET config_json = EXCLUDED.config_json, updated_at = NOW()`,
      [serialized]
    );
  } catch (err) {
    console.warn('[ADMIN] PostgreSQL backup write for live2d config failed (Redis is authoritative):', err);
  }
}

export async function GET(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  try {
    const config = await loadLive2dConfig();
    return NextResponse.json({ ok: true, data: config });
  } catch (err) {
    console.error('[ADMIN] Failed to load live2d config:', err);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load live2d config' } },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  const parsed = Live2dPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
      },
      { status: 400 }
    );
  }

  try {
    const current = await loadLive2dConfig();
    const merged: Live2dConfig = {
      ...current,
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    };
    await saveLive2dConfig(merged);

    return NextResponse.json({ ok: true, data: merged });
  } catch (err) {
    console.error('[ADMIN] Failed to save live2d config:', err);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to save live2d config' } },
      { status: 500 }
    );
  }
}

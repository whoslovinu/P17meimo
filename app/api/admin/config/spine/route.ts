/**
 * /api/admin/config/spine — get / persist Spine model + stage thresholds.
 *
 * FIX H-3: this route used to print to console and return { ok: true }, meaning
 * every operator-side save was lost on the next server boot. We now persist
 * to Redis (single source of truth — survives restarts and is shared across
 * instances) and persist to PostgreSQL as a hard backup.
 *
 * Body shape (all fields optional):
 *   {
 *     modelZipUrl?: string,
 *     bgStage1?: string,
 *     bgStage2?: string,
 *     stage1Threshold?: number,
 *     stage2Threshold?: number,
 *     stage3Threshold?: number,
 *   }
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getRedisClient, REDIS_KEYS } from '@/lib/redis';
import { getPostgresPool } from '@/lib/db/postgres';
import { z } from 'zod';

const SpinePayloadSchema = z.object({
  modelZipUrl:      z.string().url().max(2048).optional(),
  bgStage1:         z.string().max(2048).optional(),
  bgStage2:         z.string().max(2048).optional(),
  stage1Threshold:  z.number().int().min(0).max(100).optional(),
  stage2Threshold:  z.number().int().min(0).max(100).optional(),
  stage3Threshold:  z.number().int().min(0).max(100).optional(),
});

const SPINE_CONFIG_PERSIST_TTL = 60 * 60 * 24 * 30; // 30 days

interface SpineConfig {
  modelZipUrl:      string;
  bgStage1:         string;
  bgStage2:         string;
  stage1Threshold:  number;
  stage2Threshold:  number;
  stage3Threshold:  number;
  updatedAt?:       string;
}

const DEFAULT_SPINE_CONFIG: SpineConfig = {
  modelZipUrl: '/spine/meimo-model.zip',
  bgStage1:    '/bg-stage1.png',
  bgStage2:    '/bg-stage2.png',
  stage1Threshold: 75,
  stage2Threshold: 50,
  stage3Threshold: 25,
};

async function loadSpineConfig(): Promise<SpineConfig> {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(REDIS_KEYS.SPINE_CONFIG);
    if (raw) {
      return { ...DEFAULT_SPINE_CONFIG, ...(JSON.parse(raw) as Partial<SpineConfig>) };
    }
  } catch (err) {
    console.warn('[ADMIN] Redis read for spine config failed, falling back to PostgreSQL:', err);
  }

  try {
    const pool = getPostgresPool();
    const row = await pool.query<{ config_json: string | null }>(
      `SELECT config_json FROM public.repark_config WHERE key = $1 LIMIT 1`,
      ['spine']
    );
    if (row.rows[0]?.config_json) {
      return { ...DEFAULT_SPINE_CONFIG, ...(JSON.parse(row.rows[0].config_json) as Partial<SpineConfig>) };
    }
  } catch (err) {
    console.warn('[ADMIN] PostgreSQL read for spine config failed:', err);
  }

  return DEFAULT_SPINE_CONFIG;
}

async function saveSpineConfig(config: SpineConfig): Promise<void> {
  const serialized = JSON.stringify(config);

  try {
    const redis = getRedisClient();
    await redis.set(REDIS_KEYS.SPINE_CONFIG, serialized, 'EX', SPINE_CONFIG_PERSIST_TTL);
  } catch (err) {
    console.error('[ADMIN] Redis write for spine config failed:', err);
    throw err;
  }

  try {
    const pool = getPostgresPool();
    await pool.query(
      `INSERT INTO public.repark_config (key, config_json, updated_at)
       VALUES ('spine', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET config_json = EXCLUDED.config_json, updated_at = NOW()`,
      [serialized]
    );
  } catch (err) {
    console.warn('[ADMIN] PostgreSQL backup write for spine config failed (Redis is authoritative):', err);
  }
}

export async function GET(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  try {
    const config = await loadSpineConfig();
    return NextResponse.json({ ok: true, data: config });
  } catch (err) {
    console.error('[ADMIN] Failed to load spine config:', err);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load spine config' } },
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

  const parsed = SpinePayloadSchema.safeParse(body);
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
    const current = await loadSpineConfig();
    const merged: SpineConfig = {
      ...current,
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    };
    await saveSpineConfig(merged);

    return NextResponse.json({ ok: true, data: merged });
  } catch (err) {
    console.error('[ADMIN] Failed to save spine config:', err);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to save spine config' } },
      { status: 500 }
    );
  }
}

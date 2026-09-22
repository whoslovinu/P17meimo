/**
 * /api/admin/config/damage-weights — get / persist weighted damage rows.
 *
 * FIX H-3: previous version was a stub that only validated `weights` summed
 * to 100 and returned them. It never persisted anything, so the attack
 * endpoint always fell back to its hardcoded 10/25 baseline. We now persist
 * the rows in Redis + PostgreSQL like the other config endpoints.
 *
 * Body shape:
 *   {
 *     weights: Array<{ id: string, label: string, minDamage: number, maxDamage: number, weight: number }>,
 *   }
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getRedisClient, REDIS_KEYS } from '@/lib/redis';
import { getPostgresPool } from '@/lib/db/postgres';
import { z } from 'zod';

const DamageWeightSchema = z.object({
  id:        z.string().min(1).max(64),
  label:     z.string().min(1).max(64),
  minDamage: z.number().int().min(0).max(1_000_000),
  maxDamage: z.number().int().min(0).max(1_000_000),
  weight:    z.number().min(0).max(100),
});

const PayloadSchema = z.object({
  weights: z.array(DamageWeightSchema).min(1).max(20),
});

const DAMAGE_WEIGHTS_PERSIST_TTL = 60 * 60 * 24 * 30;

interface DamageWeight {
  id:        string;
  label:     string;
  minDamage: number;
  maxDamage: number;
  weight:    number;
}

async function loadDamageWeights(): Promise<DamageWeight[] | null> {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(REDIS_KEYS.DAMAGE_WEIGHTS);
    if (raw) return JSON.parse(raw) as DamageWeight[];
  } catch (err) {
    console.warn('[ADMIN] Redis read for damage weights failed:', err);
  }

  try {
    const pool = getPostgresPool();
    const row = await pool.query<{ config_json: string | null }>(
      `SELECT config_json FROM public.repark_config WHERE key = $1 LIMIT 1`,
      ['damage_weights']
    );
    if (row.rows[0]?.config_json) {
      return JSON.parse(row.rows[0].config_json) as DamageWeight[];
    }
  } catch (err) {
    console.warn('[ADMIN] PostgreSQL read for damage weights failed:', err);
  }

  return null;
}

async function saveDamageWeights(weights: DamageWeight[]): Promise<void> {
  const serialized = JSON.stringify(weights);

  try {
    const redis = getRedisClient();
    await redis.set(REDIS_KEYS.DAMAGE_WEIGHTS, serialized, 'EX', DAMAGE_WEIGHTS_PERSIST_TTL);
  } catch (err) {
    console.error('[ADMIN] Redis write for damage weights failed:', err);
    throw err;
  }

  try {
    const pool = getPostgresPool();
    await pool.query(
      `INSERT INTO public.repark_config (key, config_json, updated_at)
       VALUES ('damage_weights', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET config_json = EXCLUDED.config_json, updated_at = NOW()`,
      [serialized]
    );
  } catch (err) {
    console.warn('[ADMIN] PostgreSQL backup write for damage weights failed (Redis is authoritative):', err);
  }
}

export async function GET(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  try {
    const weights = await loadDamageWeights();
    return NextResponse.json({
      ok: true,
      data: weights ? { weights, totalWeight: weights.reduce((s, w) => s + (w.weight || 0), 0) } : { weights: null },
    });
  } catch (err) {
    console.error('[ADMIN] Failed to load damage weights:', err);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load damage weights' } },
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

  const parsed = PayloadSchema.safeParse(body);
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

  const weights = parsed.data.weights;

  for (const w of weights) {
    if (w.minDamage > w.maxDamage) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'BAD_REQUEST',
            message: `Row "${w.id}" has minDamage > maxDamage`,
          },
        },
        { status: 400 }
      );
    }
  }

  const totalWeight = weights.reduce((sum, w) => sum + (w.weight || 0), 0);
  if (Math.abs(totalWeight - 100) > 1e-6) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: `Weight total must equal 100% (current: ${totalWeight}%)` },
      },
      { status: 400 }
    );
  }

  try {
    await saveDamageWeights(weights);
    return NextResponse.json({ ok: true, data: { weights, totalWeight } });
  } catch (err) {
    console.error('[ADMIN] Failed to save damage weights:', err);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to save damage weights' } },
      { status: 500 }
    );
  }
}
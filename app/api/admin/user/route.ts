/**
 * GET /api/admin/users — List all users with dynamic damage aggregation
 *
 * Migrated from Supabase → AWS RDS via lib/db/pg.ts.
 *
 * Supports:
 *   - ?search=xxx — searches by id (case-insensitive)
 *   - Damage is read from user_inventory.total_damage_dealt
 *   - Results sorted by totalDamage descending (leaderboard order)
 *
 * On DB failure: returns HTTP 500. NO silent fallback.
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getPostgresPool } from '@/lib/db/postgres';

interface UserRow {
  id: string;
  item_hand_count: number;
  item_phallus_count: number;
  total_damage_dealt: number;
  status: string | null;
  updated_at: string;
  created_at: string;
}

interface MilestoneRow {
  user_id: string;
  milestone_id: number;
  is_claimed: boolean;
  is_locked: boolean;
  claimed_at: string | null;
}

export async function GET(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search')?.trim() ?? '';

  try {
    const pool = getPostgresPool();

    // 1. Fetch all user inventories
    const usersResult = await pool.query<UserRow>(
      `SELECT user_id AS id, item_hand_count, item_phallus_count, total_damage_dealt, status, updated_at, created_at
         FROM public.user_inventory
        ORDER BY total_damage_dealt DESC NULLS LAST`
    );
    const users = usersResult.rows;

    // 2. Fetch all milestone rewards in one query
    let msMap = new Map<string, Record<string, { is_claimed: boolean; is_locked: boolean; claimed_at: string | null }>>();
    if (users.length > 0) {
      const userIds = users.map((u) => u.id);
      const msResult = await pool.query<MilestoneRow>(
        `SELECT user_id, milestone_id, is_claimed, is_locked, claimed_at
           FROM public.milestone_rewards
          WHERE user_id = ANY($1::uuid[])`,
        [userIds]
      );
      for (const row of msResult.rows) {
        if (!msMap.has(row.user_id)) msMap.set(row.user_id, {});
        msMap.get(row.user_id)![String(row.milestone_id)] = {
          is_claimed: row.is_claimed,
          is_locked: row.is_locked,
          claimed_at: row.claimed_at,
        };
      }
    }

    // 3. Build result
    let result = users.map((u) => {
      const milestoneStates = msMap.get(u.id) ?? {};
      return {
        id: u.id,
        email: '',
        nickname: '',
        avatar: '👤',
        inventory: {
          propA: Number(u.item_hand_count ?? 0),
          propB: Number(u.item_phallus_count ?? 0),
        },
        totalDamage: Number(u.total_damage_dealt ?? 0),
        status: u.status ?? 'normal',
        lastLogin: u.updated_at ?? u.created_at,
        createdAt: u.created_at,
        milestoneStates,
      };
    });

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((u) => u.id.toLowerCase().includes(q));
    }

    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error('[ADMIN:USER:GET] fatal error:', err);
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
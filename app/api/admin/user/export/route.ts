/**
 * GET /api/admin/users/export — CSV export of attack_logs / milestones / audit_log.
 *
 * Migrated from Supabase → AWS RDS via lib/db/postgres raw queries.
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getPostgresPool } from '@/lib/db/postgres';
import { logAdminAction, getClientIp, getOperatorId } from '@/lib/auditLog';

function escapeCsv(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [
    headers.join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ].join('\n');
}

// FIX H-10: Bound CSV exports. A malicious operator or runaway query
// previously pulled every row in the table — millions of attack_logs
// would lock the connection pool and OOM the Node process. Cap is
// configurable per type but always applied. Exceeding the cap yields a
// truncated CSV with a warning row at the top so operators can re-export
// by user / date range instead.
const EXPORT_LIMITS = {
  attack_logs: 100_000,
  milestones:  100_000,
  audit:        50_000,
} as const;

const OVER_LIMIT_BANNER = (exported: number, cap: number, type: string): string =>
  `# WARNING: Result truncated. ${type} export limited to ${cap} rows; ${exported} rows were emitted. ` +
  `Refine with ?userId= or contact engineering for a larger window.\n`;

export async function GET(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const exportType = searchParams.get('type') ?? 'attack_logs';

  const operatorId = getOperatorId(req);
  const ip = getClientIp(req);

  logAdminAction({
    route: '/api/admin/users/export',
    action: 'export_data',
    operatorId,
    targetUserId: userId ?? 'all',
    clientIp: ip,
    success: true,
    fieldName: exportType,
    newValue: { userId, exportType },
  });

  try {
    const pool = getPostgresPool();

    if (exportType === 'attack_logs' || exportType === 'all') {
      const params: unknown[] = [];
      let where = '';
      if (userId) {
        params.push(userId);
        where = `WHERE user_id = $1`;
      }
      const cap = EXPORT_LIMITS.attack_logs;
      params.push(cap);
      const limitParam = `$${params.length}`;
      const result = await pool.query<{
        id: string;
        user_id: string;
        item_used: string;
        damage_dealt: number;
        created_at: string;
      }>(
        `SELECT id, user_id, item_used, damage_dealt, created_at
           FROM public.attack_logs
           ${where}
          ORDER BY created_at DESC
          LIMIT ${limitParam}`,
        params
      );

      const csv = toCsv(
        ['id', 'user_id', 'item_used', 'damage_dealt', 'created_at'],
        result.rows.map((r) => [r.id, r.user_id, r.item_used, r.damage_dealt, r.created_at])
      );

      const body = result.rows.length >= cap ? OVER_LIMIT_BANNER(result.rows.length, cap, 'attack_logs') + csv : csv;

      return new Response(body, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="attack_logs_${userId ?? 'all'}_${Date.now()}.csv"`,
        },
      });
    }

    if (exportType === 'milestones') {
      const params: unknown[] = [];
      let where = '';
      if (userId) {
        params.push(userId);
        where = `WHERE user_id = $1`;
      }
      const cap = EXPORT_LIMITS.milestones;
      params.push(cap);
      const limitParam = `$${params.length}`;
      const result = await pool.query<{
        user_id: string;
        milestone_id: number;
        is_claimed: boolean;
        is_locked: boolean;
        claimed_at: string | null;
        created_at: string;
      }>(
        `SELECT user_id, milestone_id, is_claimed, is_locked, claimed_at, created_at
           FROM public.milestone_rewards
           ${where}
          ORDER BY created_at DESC
          LIMIT ${limitParam}`,
        params
      );

      const csv = toCsv(
        ['user_id', 'milestone_id', 'is_claimed', 'is_locked', 'claimed_at', 'created_at'],
        result.rows.map((r) => [
          r.user_id,
          r.milestone_id,
          r.is_claimed,
          r.is_locked,
          r.claimed_at,
          r.created_at,
        ])
      );

      const body = result.rows.length >= cap ? OVER_LIMIT_BANNER(result.rows.length, cap, 'milestones') + csv : csv;

      return new Response(body, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="milestone_rewards_${userId ?? 'all'}_${Date.now()}.csv"`,
        },
      });
    }

    if (exportType === 'audit') {
      const params: unknown[] = [];
      let where = '';
      if (userId) {
        params.push(userId);
        where = `WHERE target_user_id = $1`;
      }
      const cap = EXPORT_LIMITS.audit;
      params.push(cap);
      const limitParam = `$${params.length}`;
      const result = await pool.query<{
        id: number;
        route: string;
        action: string;
        operator_id: string;
        target_user_id: string;
        field_name: string | null;
        old_value: string | null;
        new_value: string | null;
        ip_address: string | null;
        created_at: string;
      }>(
        `SELECT id, route, action, operator_id, target_user_id, field_name,
                old_value, new_value, ip_address, created_at
           FROM public.admin_audit_log
           ${where}
          ORDER BY created_at DESC
          LIMIT ${limitParam}`,
        params
      );

      const csv = toCsv(
        [
          'id',
          'route',
          'action',
          'operator_id',
          'target_user_id',
          'field_name',
          'old_value',
          'new_value',
          'ip_address',
          'created_at',
        ],
        result.rows.map((r) => [
          r.id,
          r.route,
          r.action,
          r.operator_id,
          r.target_user_id,
          r.field_name,
          r.old_value,
          r.new_value,
          r.ip_address,
          r.created_at,
        ])
      );

      const body = result.rows.length >= cap ? OVER_LIMIT_BANNER(result.rows.length, cap, 'audit') + csv : csv;

      return new Response(body, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="admin_audit_${userId ?? 'all'}_${Date.now()}.csv"`,
        },
      });
    }

    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Unknown export type. Use: attack_logs | milestones | audit' } },
      { status: 400 }
    );
  } catch (err) {
    console.error('[ADMIN:EXPORT] fatal error:', err);
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
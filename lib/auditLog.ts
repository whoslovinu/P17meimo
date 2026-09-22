/**
 * lib/auditLog.ts — Console-only audit logging (post-Supabase).
 *
 * The previous implementation wrote to Supabase `admin_audit_log`.
 * After Supabase decommissioning, the persistent audit log table lives
 * on AWS RDS and is populated via `lib/db/pg.ts` `insertAuditLog()`.
 *
 * This module wraps the persistent call and ALSO emits a structured
 * console log so operators can grep logs in real time.
 */

import { insertAuditLog, insertWebhookAudit } from '@/lib/db/pg';

export interface WebhookLogEntry {
  success: boolean;
  eventId: string;
  action: string;
  clientIp: string;
  duration?: number;
  result?: string;
  error?: string;
  // Optional diagnostic context — caller in route.ts fills these as soon as it
  // has them. Anything left undefined is omitted from the DB row.
  httpStatus?: number;
  userId?: string | null;
  rawUserId?: string | null;
  rawBody?: string | null;        // only sent on failures; capped at 8KB by pg.ts
  errorCode?: string | null;
}

export interface AdminActionLogEntry {
  route: string;
  action: string;
  operatorId?: string;
  targetUserId?: string;
  clientIp: string;
  success: boolean;
  duration?: number;
  error?: string;
  fieldName?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

function emitConsole(level: 'log' | 'warn', entry: Record<string, unknown>): void {
  const message = `[AUDIT] ${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}`;
  if (level === 'log') console.log(message);
  else console.warn(message);
}

function persistAsync(payload: {
  route: string;
  action: string;
  operatorId: string;
  targetUserId: string;
  clientIp: string | null;
  fieldName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
}): void {
  insertAuditLog(
    payload.route,
    payload.action,
    payload.operatorId,
    payload.targetUserId,
    payload.clientIp,
    payload.fieldName ?? null,
    payload.oldValue ?? null,
    payload.newValue ?? null
  ).catch((err) => {
    console.warn('[AUDIT] Failed to persist admin action log:', err);
  });
}

export function logWebhookEvent(entry: WebhookLogEntry): void {
  emitConsole(entry.success ? 'log' : 'warn', {
    type: 'webhook',
    success: entry.success,
    eventId: entry.eventId,
    action: entry.action,
    clientIp: entry.clientIp,
    duration: entry.duration,
    httpStatus: entry.httpStatus,
    result: entry.result,
    error: entry.error,
    errorCode: entry.errorCode,
  });

  // Persist to webhook_audit. Fire-and-forget: the audit table is diagnostic
  // only and must never block the webhook response. A failure to write is
  // logged but not surfaced to the caller.
  insertWebhookAudit({
    txId: entry.eventId === '?' ? null : entry.eventId,
    actionType: entry.action,
    userId: entry.userId ?? null,
    rawUserId: entry.rawUserId ?? null,
    clientIp: entry.clientIp,
    durationMs: entry.duration ?? null,
    httpStatus: entry.httpStatus ?? null,
    success: entry.success,
    result: entry.result ?? null,
    errorCode: entry.errorCode ?? null,
    errorMessage: entry.error ?? null,
    rawBody: entry.rawBody ?? null,
  }).catch((err) => {
    console.warn('[AUDIT] Failed to persist webhook_audit row:', err);
  });
}

export function logAdminAction(entry: AdminActionLogEntry): void {
  emitConsole(entry.success ? 'log' : 'warn', {
    type: 'admin_action',
    success: entry.success,
    route: entry.route,
    action: entry.action,
    operatorId: entry.operatorId ?? 'unknown',
    targetUserId: entry.targetUserId ?? '',
    clientIp: entry.clientIp,
    duration: entry.duration,
    fieldName: entry.fieldName,
    error: entry.error,
  });

  persistAsync({
    route: entry.route,
    action: entry.action,
    operatorId: entry.operatorId ?? 'admin',
    targetUserId: entry.targetUserId ?? '',
    clientIp: entry.clientIp ?? null,
    fieldName: entry.fieldName ?? null,
    oldValue: entry.oldValue != null ? JSON.stringify(entry.oldValue) : null,
    newValue: entry.newValue != null ? JSON.stringify(entry.newValue) : null,
  });
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    req.headers.get('cf-connecting-ip') ??
    'unknown'
  );
}

export function getOperatorId(req: Request): string {
  return req.headers.get('x-admin-operator') ?? 'admin';
}

export function startTimer(label: string): { end: () => number } {
  const start = Date.now();
  return {
    end: () => {
      const duration = Date.now() - start;
      console.log(`[TIMING] ${label}: ${duration}ms`);
      return duration;
    },
  };
}
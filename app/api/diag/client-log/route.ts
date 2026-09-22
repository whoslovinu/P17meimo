import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ════════════════════════════════════════════════════════════════════════════════
// DIAG CLIENT-LOG SHIPPER (v1.6 — 2026-07-23)
//
// Customer repro: "弹窗反复弹出" — we have no client-side console capture in
// production, so we're flying blind on modal mount/unmount sequences. This
// endpoint accepts a batched log payload from the browser and writes each
// line to stdout with a [DIAG] prefix so `pm2 logs repark-h5` can be grepped
// for the exact event timeline. Once we have real evidence, we can fix the
// root cause; until then, every code change is a guess.
//
// Schema (loose, intentionally — clients may vary):
//   {
//     sessionId: string,    // stable per browser tab, lets us correlate
//     origin:    string,    // 'battle' | 'subpage-modal' | 'modal-store'
//     events:    Array<{ ts: number, level: 'info'|'warn'|'error', msg: string, stack?: string }>
//   }
//
// No auth: this is a diagnostic endpoint, only ever on in-flight production
// while we chase a specific repro. Will be removed once customer confirms fix.
// ════════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const payload = body as {
    sessionId?: string;
    origin?: string;
    events?: Array<{ ts?: number; level?: string; msg?: string; stack?: string }>;
  };

  const sessionId = String(payload?.sessionId ?? 'no-session');
  const origin = String(payload?.origin ?? 'unknown');
  const events = Array.isArray(payload?.events) ? payload.events : [];

  for (const e of events) {
    const ts = typeof e?.ts === 'number' ? e.ts : Date.now();
    const level = (e?.level || 'info').toUpperCase();
    const msg = String(e?.msg ?? '').slice(0, 2000);
    const stack = e?.stack ? String(e.stack).slice(0, 4000) : '';
    // stdout — picked up by pm2
    console.log(`[DIAG][${level}][${origin}][sid=${sessionId.slice(0, 12)}][t=${ts}] ${msg}`);
    if (stack) {
      for (const line of stack.split('\n').slice(0, 8)) {
        console.log(`[DIAG][STACK]   ${line}`);
      }
    }
  }

  return NextResponse.json({ ok: true, received: events.length });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: 'POST { sessionId, origin, events: [{ts,level,msg,stack?}] } to ship client diagnostics',
  });
}

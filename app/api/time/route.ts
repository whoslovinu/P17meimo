import { NextResponse } from 'next/server';

// ════════════════════════════════════════════════════════════════════════════════
// SERVER TIME ENDPOINT
// Returns the server's current Unix ms timestamp.
// Clients use this to compute a clock-offset so that the countdown timer
// cannot be manipulated by local system-clock tampering.
//
// TC-BT-01/14: Countdown timer server-time sync
// ════════════════════════════════════════════════════════════════════════════════

export async function GET() {
  return NextResponse.json({
    ok: true,
    serverTime: Date.now(),
    iso: new Date().toISOString(),
  });
}

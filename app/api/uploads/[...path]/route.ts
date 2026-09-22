/**
 * Dynamic file server for uploaded assets.
 * ─────────────────────────────────────────────────────────────────────────────
 * Problem: `lib/upload.ts` writes files to `public/uploads/<path>` and
 * returns URLs like `/uploads/image/xxx.jpg`.  In production (`next start`)
 * Next.js does NOT dynamically serve files from `public/` — it only bakes
 * them into the build output at startup.  This route fills that gap.
 *
 * Design decisions:
 *   • Resolves files relative to `process.cwd()`/public/uploads — matches
 *     the write path in `lib/upload.ts` exactly.
 *   • MIME type is inferred from the file extension — no need for a DB lookup.
 *   • HEAD requests are handled (for image preload / browser cache probing).
 *   • Range requests are NOT supported (not needed for banner images).
 *   • Any path traversal attempt (`..`) is rejected with 400.
 *
 * Usage:
 *   GET /api/uploads/image/xxx.jpg
 *   → 200 image/jpeg  <binary data>
 *   → 404 (file not found)
 *   → 400 (path traversal attempt)
 */

import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

// ── MIME lookup table (banner-relevant subset only) ──────────────────────────

const MIME_MAP: Record<string, string> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.bmp':  'image/bmp',
  '.ico':  'image/x-icon',
};

// ── Route handler ───────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: splat } = await params;

  // Reject path-traversal attempts: `../` anywhere in the path is blocked.
  if (splat.some((segment) => segment === '..' || segment.includes('/'))) {
    return NextResponse.json(
      { ok: false, error: 'Invalid path' },
      { status: 400 },
    );
  }

  // Resolve to <cwd>/public/uploads/<splat.join('/')>
  const safeRelative = splat.join('/').replace(/\\/g, '/');
  const publicDir = path.resolve(process.cwd(), 'public', 'uploads');
  const filePath = path.resolve(publicDir, safeRelative);

  // Guard: resolved path must still be inside public/uploads/
  if (!filePath.startsWith(publicDir + path.sep)) {
    return NextResponse.json(
      { ok: false, error: 'Forbidden' },
      { status: 403 },
    );
  }

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'File not found' },
      { status: 404 },
    );
  }

  if (!stat.isFile()) {
    return NextResponse.json(
      { ok: false, error: 'Not a file' },
      { status: 400 },
    );
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_MAP[ext] ?? 'application/octet-stream';

  let buf: Buffer;
  try {
    buf = await fs.readFile(filePath);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Failed to read file' },
      { status: 500 },
    );
  }

  // buf.buffer is typed ArrayBuffer | SharedArrayBuffer (DOM lib); Node Buffer always
  // uses a plain ArrayBuffer, so we safely narrow it.
  const raw = buf.buffer as ArrayBuffer;
  const byteOffset = buf.byteOffset;
  const byteLength = buf.byteLength;
  const arrayBuffer = raw.slice(byteOffset, byteOffset + byteLength);

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      'Content-Type':  contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(byteLength),
    },
  });
}

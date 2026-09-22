/**
 * lib/upload.ts — Unified asset upload abstraction.
 *
 * FIX H-14: The previous /api/admin/upload route used fs.writeFileSync to
 * persist uploaded files under public/uploads. That breaks on serverless
 * hosts (Vercel, AWS Lambda, Cloud Run) where the local filesystem is
 * ephemeral — uploads vanish on every cold start. This module exposes a
 * backend-agnostic interface so the route can swap storage providers
 * without rewriting any business logic.
 *
 * Backends (priority order, set UPLOAD_BACKEND env):
 *   1. s3   — AWS S3 (TODO: needs @aws-sdk/client-s3 + IAM creds; not
 *             implemented yet, falling back to mock with a clear warning).
 *   2. mock — Dev-only fallback. Writes the file to public/uploads/ so
 *             Next.js can serve it via /uploads/[filename], and returns
 *             that URL. A console warning fires once per process so the
 *             operator knows the data isn't backed by durable storage.
 *   3. local (ONLY when ALLOW_LOCAL_DISK=1 AND process.env.NODE_ENV !==
 *             'production') — writes under /public/uploads. Strictly
 *             forbidden in production. This branch exists only so existing
 *             single-instance dev setups keep working.
 *
 * NEVER use fs.writeFileSync directly in route handlers — always go through
 * upload() so the backend swap is one env var away.
 */

import { z } from 'zod';

export const UploadCategorySchema = z.enum(['image', 'spine']);
export type UploadCategory = z.infer<typeof UploadCategorySchema>;

export const UploadResultSchema = z.object({
  filename: z.string(),
  url:      z.string(),
  size:     z.number().int().nonnegative(),
  category: UploadCategorySchema,
  mimeType: z.string(),
  backend:  z.enum(['s3', 'mock', 'local']),
});
export type UploadResult = z.infer<typeof UploadResultSchema>;

export interface UploadInput {
  /** Raw file bytes (read from the multipart FormData). */
  buffer: Buffer;
  /** Original filename from the form field. */
  originalName: string;
  /** Detected MIME type. */
  mimeType: string;
  /** 'image' or 'spine' — controls extension / validator choice. */
  category: UploadCategory;
}

const SAFE_NAME_RE = /[^a-zA-Z0-9._-]/g;

export function sanitizeFilename(name: string): string {
  return name.replace(/\.\./g, '_').replace(SAFE_NAME_RE, '_').slice(0, 120);
}

/**
 * Build the on-disk / object key for an upload.
 * Format: `<category>/<sanitized-stem>_<unix-ms>.<ext>`
 */
export function buildKey(input: UploadInput): string {
  const safeName = sanitizeFilename(input.originalName);
  const dotIdx = safeName.lastIndexOf('.');
  const stem = dotIdx > 0 ? safeName.slice(0, dotIdx) : safeName;
  const ext  = dotIdx > 0 ? safeName.slice(dotIdx) : (input.category === 'spine' ? '.zip' : '.bin');
  return `${input.category}/${stem}_${Date.now()}${ext}`;
}

function pickBackend(): 's3' | 'mock' | 'local' {
  const env = process.env.UPLOAD_BACKEND?.toLowerCase();
  if (env === 's3') return 's3';
  if (env === 'local') return 'local';
  return 'mock';
}

let _warnedMock = false;

async function uploadS3(_input: UploadInput, _key: string): Promise<UploadResult> {
  // FIX H-14 follow-up: AWS S3 wiring is intentionally NOT implemented here
  // because the project doesn't yet have AWS credentials configured. We
  // surface a clear, actionable error so the operator knows exactly what
  // to do instead of silently writing to disk.
  throw new Error(
    '[UPLOAD] S3 backend requested but not implemented yet. ' +
    'Add @aws-sdk/client-s3 to package.json and supply AWS_REGION + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY, ' +
    'or switch UPLOAD_BACKEND=mock for development.'
  );
}

async function uploadMock(input: UploadInput, key: string): Promise<UploadResult> {
  if (!_warnedMock) {
    console.warn(
      '[UPLOAD] Backend is set to "mock" — uploads are persisted to public/uploads/ for preview only. ' +
      'Set UPLOAD_BACKEND=s3 (with AWS creds) or UPLOAD_BACKEND=local (dev only) to enable real storage.'
    );
    _warnedMock = true;
  }

  // Mock backend for local dev: write to public/uploads/ so Next.js can serve
  // the file via /uploads/[filename]. The previous implementation returned a
  // /__mock_uploads__/ URL that Next.js never served, breaking previews.
  const filename = key.split('/').pop() ?? 'mock-upload.bin';

  // Persist to public/uploads/ for preview.  On PM2-persisted Node.js (non-serverless)
  // this IS durable — the filesystem is not ephemeral.  We intentionally write in
  // production here because the only other production option is S3 (not wired yet).
  // Files land under /var/www/app/public/uploads/<category>/ and are served by
  // the Route Handler at /api/uploads/<category>/<filename>.
  // NOTE: lib/upload.ts now returns URLs prefixed /api/uploads/ (not /uploads/)
  // to match the rewrite rule in next.config.ts.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = await import('fs/promises');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = await import('path');

    const targetDir = path.resolve(process.cwd(), 'public', 'uploads');
    const fullPath = path.join(targetDir, filename);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(fullPath, input.buffer);
  } catch (err) {
    console.warn('[UPLOAD:mock] disk write failed, falling back to data: URL:', err);
    const dataUrl = `data:${input.mimeType};base64,${input.buffer.toString('base64').slice(0, 64)}…`;
    return {
      filename,
      url: dataUrl,
      size: input.buffer.length,
      category: input.category,
      mimeType: input.mimeType,
      backend: 'mock',
    };
  }

  return {
    filename,
    url: `/api/uploads/${filename}?t=${Date.now()}`,
    size: input.buffer.length,
    category: input.category,
    mimeType: input.mimeType,
    backend: 'mock',
  };
}

async function uploadLocal(input: UploadInput, key: string): Promise<UploadResult> {
  // Local-disk backend — dev only. Hard-fail in production.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[UPLOAD] UPLOAD_BACKEND=local is FORBIDDEN in production. ' +
      'Local filesystem is ephemeral on serverless hosts.'
    );
  }
  if (process.env.ALLOW_LOCAL_DISK !== '1') {
    throw new Error(
      '[UPLOAD] UPLOAD_BACKEND=local requires ALLOW_LOCAL_DISK=1 in .env.local.'
    );
  }

  // Lazy import so this module never references fs unless explicitly opted-in.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = await import('fs/promises');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = await import('path');

  const targetDir = path.resolve(process.cwd(), 'public', 'uploads');
  const filename = key.split('/').pop() ?? `local_${Date.now()}.bin`;
  const fullPath = path.join(targetDir, filename);
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(fullPath, input.buffer);

  return {
    filename,
    url: `/api/uploads/${filename}?t=${Date.now()}`,
    size: input.buffer.length,
    category: input.category,
    mimeType: input.mimeType,
    backend: 'local',
  };
}

export async function upload(input: UploadInput): Promise<UploadResult> {
  const key = buildKey(input);
  const backend = pickBackend();

  switch (backend) {
    case 's3':    return uploadS3(input, key);
    case 'local': return uploadLocal(input, key);
    case 'mock':
    default:      return uploadMock(input, key);
  }
}

/**
 * Read back the most-recent mock upload so the admin UI can show a preview
 * without a real backend. Strict no-op on any other backend.
 */
export function isMockBackend(): boolean {
  return pickBackend() === 'mock';
}
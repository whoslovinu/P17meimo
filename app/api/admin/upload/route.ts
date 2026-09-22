/**
 * POST /api/admin/upload — Accept image/* or Spine .zip bundles.
 *
 * FIX H-14: replaced fs.writeFileSync with the unified `lib/upload`
 * abstraction. The route no longer knows anything about disk vs S3 vs
 * mock — the backend is selected by UPLOAD_BACKEND env. This makes the
 * route Vercel/Lambda-safe (writes don't evaporate on cold start).
 *
 * Multipart form fields:
 *   - file: the binary (required)
 *   - type: 'spine' | 'zip' | undefined → 'image'
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { logAdminAction, getClientIp, getOperatorId } from '@/lib/auditLog';
import { upload, isMockBackend, type UploadInput, type UploadCategory } from '@/lib/upload';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_SPINE_TYPES = ['application/zip', 'application/x-zip-compressed'];

function isZipMagic(buf: Buffer): boolean {
  return buf[0] === 0x50 && buf[1] === 0x4B;
}

// Scans a ZIP buffer for required Spine bundle files.
function scanZipContents(buf: Buffer): { ok: boolean; missing: string[]; found: string[] } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const PK = 0x04034b50;
  const found: string[] = [];
  let offset = 0;
  const data = buf;

  while (offset < data.length - 4) {
    const sig = data.readUInt32LE(offset);
    if (sig === PK) {
      const nameLen = data.readUInt16LE(offset + 26);
      const extraLen = data.readUInt16LE(offset + 28);
      const name = data.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
      found.push(name);
      offset += 30 + nameLen + extraLen + data.readUInt32LE(offset + 18);
    } else {
      offset++;
    }
  }

  const required = ['.json', '.atlas', '.png'];
  const extSet = new Set(found.map((f) => path.extname(f).toLowerCase()));
  const missing = required.filter((ext) => ![...extSet].includes(ext));

  // Allow if at least .json and .atlas are present (some packs may use .jpg etc.)
  const ok = missing.length === 0 || (!missing.includes('.json') && !missing.includes('.atlas'));
  return { ok, missing, found };
}

export async function POST(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const operatorId = getOperatorId(req);
  const clientIp = getClientIp(req);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid form data' } },
      { status: 400 }
    );
  }

  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'No file provided' } },
      { status: 400 }
    );
  }

  const uploadTypeRaw = formData.get('type') as string | null;
  const category: UploadCategory = (uploadTypeRaw === 'spine' || uploadTypeRaw === 'zip') ? 'spine' : 'image';
  const isSpineUpload = category === 'spine';

  if (isSpineUpload) {
    if (!ALLOWED_SPINE_TYPES.includes(file.type) && file.type !== 'application/octet-stream') {
      return NextResponse.json(
        { ok: false, error: { code: 'INVALID_TYPE', message: 'Only .zip files are allowed for Spine bundles' } },
        { status: 400 }
      );
    }
  } else {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { ok: false, error: { code: 'INVALID_TYPE', message: 'Only JPG / PNG / WEBP allowed' } },
        { status: 400 }
      );
    }
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { ok: false, error: { code: 'FILE_TOO_LARGE', message: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB limit` } },
      { status: 400 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());

  if (isSpineUpload) {
    if (!isZipMagic(buf)) {
      return NextResponse.json(
        { ok: false, error: { code: 'INVALID_TYPE', message: 'File is not a valid ZIP archive' } },
        { status: 400 }
      );
    }

    const { ok, missing, found } = scanZipContents(buf);
    if (!ok) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'MISSING_SPINE_FILES',
            message: `ZIP缺少必需文件: ${missing.join(', ')}。Spine 资源包必须包含 .json、.atlas、和 .png 贴图文件。`,
            missing,
            found,
          },
        },
        { status: 400 }
      );
    }
  }

  const input: UploadInput = {
    buffer: buf,
    originalName: file.name,
    mimeType: file.type,
    category,
  };

  try {
    const result = await upload(input);

    logAdminAction({
      route: '/api/admin/upload',
      action: 'upload',
      operatorId,
      clientIp,
      success: true,
      fieldName: category,
      newValue: {
        filename: result.filename,
        size: result.size,
        backend: result.backend,
        mock: isMockBackend(),
      },
    });

    console.log(
      `[UPLOAD:${category.toUpperCase()}] OK: ${result.filename} ` +
      `(${(result.size / 1024).toFixed(1)} KB) backend=${result.backend} ` +
      `${isSpineUpload ? `found: ${scanZipContents(buf).found.join(', ')}` : ''}`
    );

    return NextResponse.json({
      ok: true,
      type: category,
      data: result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    console.error('[UPLOAD] failed:', err);
    logAdminAction({
      route: '/api/admin/upload',
      action: 'upload',
      operatorId,
      clientIp,
      success: false,
      error: message,
      newValue: { category, filename: file.name, size: buf.length },
    });
    return NextResponse.json(
      { ok: false, error: { code: 'UPLOAD_FAILED', message } },
      { status: 500 }
    );
  }
}
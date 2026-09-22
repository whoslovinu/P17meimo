import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  upsertBannerItems,
  getGlobalConfig,
  updateGlobalConfig,
  type BannerItem,
  type BannerGlobalConfig,
} from '@/app/api/admin/activity/update/bannerDb';
import { requireAdminAuth } from '@/app/lib/adminAuth';

// ── Request Schemas (Zod shields) ─────────────────────────────────────────────

const BannerItemRequestSchema = z.object({
  id: z.string().min(1).max(128),
  imageUrl: z.string().max(2048).optional().default(''),
  targetActivityId: z
    .union([z.string().min(1), z.null()])
    .optional()
    .transform((v) => (v == null ? null : v)),
  sortWeight: z.number().int().min(0).max(1_000_000).optional().default(0),
  isEnabled: z.boolean().optional().default(false),
  showCountdown: z.boolean().optional().default(false),
  createdAt: z.string().min(1).optional(),
});

const GlobalConfigRequestSchema = z
  .object({
    isGlobalEnabled: z.boolean().optional(),
    isCarouselEnabled: z.boolean().optional(),
    carouselInterval: z.number().int().positive().max(60).optional(),
  })
  .strict();

const UpdateRequestSchema = z
  .object({
    global: GlobalConfigRequestSchema.optional(),
    items: z.array(z.unknown()).optional(),
  })
  .strict();

// POST /api/admin/banners/update — full upsert (global + items array).
//
// REPARK rule: any DB failure surfaces as HTTP 500 with `ok: false`.
// The handler does NOT fabricate `ok: true` on partial write.
export async function POST(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } },
      { status: 400 }
    );
  }

  const parsed = UpdateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: parsed.error.issues
            .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
            .join('; '),
        },
      },
      { status: 400 }
    );
  }
  const { global, items } = parsed.data;

  // ── Global config update ────────────────────────────────────────────────────
  if (global) {
    try {
      await updateGlobalConfig(global);
    } catch (err: unknown) {
      const detail = err instanceof Error
        ? { name: (err as any).code ?? 'UNKNOWN', message: err.message, stack: err.stack }
        : String(err);
      console.error('[BANNER:ADMIN:UPDATE:POST] updateGlobalConfig failed:', detail);
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'DB_WRITE_FAILED',
            message: 'Failed to update banner global config',
            detail,
          },
        },
        { status: 500 }
      );
    }
  }

  // ── Items upsert ────────────────────────────────────────────────────────────
  if (Array.isArray(items)) {
    const validItems: BannerItem[] = [];
    for (const raw of items) {
      const itemParsed = BannerItemRequestSchema.safeParse(raw);
      if (!itemParsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'BAD_REQUEST',
              message: `Invalid banner item: ${itemParsed.error.issues
                .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
                .join('; ')}`,
            },
          },
          { status: 400 }
        );
      }
      validItems.push({
        ...itemParsed.data,
        imageUrl: itemParsed.data.imageUrl ?? '',
        sortWeight: itemParsed.data.sortWeight ?? 0,
        isEnabled: itemParsed.data.isEnabled ?? false,
        showCountdown: itemParsed.data.showCountdown ?? false,
        targetActivityId: itemParsed.data.targetActivityId ?? null,
        createdAt: itemParsed.data.createdAt ?? new Date().toISOString(),
        activityName: null,
      });
    }
    // P0 2026-07-30: diagnostic — log all imageUrls before DB write so operator can trace what's received
    console.log('[BANNER:ADMIN:UPDATE:POST] items to upsert:', JSON.stringify(validItems.map((i) => ({ id: i.id, imageUrl: i.imageUrl }))));

    try {
      await upsertBannerItems(validItems);
    } catch (err: unknown) {
      const detail = err instanceof Error
        ? { name: (err as any).code ?? 'UNKNOWN', message: err.message, stack: err.stack }
        : String(err);
      console.error('[BANNER:ADMIN:UPDATE:POST] upsertBannerItems failed:', detail);
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'DB_WRITE_FAILED',
            message: 'Failed to persist banner items',
            detail,
          },
        },
        { status: 500 }
      );
    }
  }

  // ── Read back the canonical state ───────────────────────────────────────────
  // If even the read-back fails, the write may have succeeded but we cannot
  // hand a stale snapshot to the client. Report 500 — never fake `ok: true`.
  let itemsOut: BannerItem[];
  let globalOut: BannerGlobalConfig;
  try {
    itemsOut = await import('@/app/api/admin/activity/update/bannerDb').then((m) =>
      m.listBanners()
    );
    globalOut = await getGlobalConfig();
  } catch (err: unknown) {
    const detail = err instanceof Error
      ? { name: (err as any).code ?? 'UNKNOWN', message: err.message, stack: err.stack }
      : String(err);
    console.error('[BANNER:ADMIN:UPDATE:POST] read-back failed:', detail);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'DB_READ_FAILED',
          message: 'Write succeeded but read-back failed',
          detail,
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, items: itemsOut, global: globalOut });
}

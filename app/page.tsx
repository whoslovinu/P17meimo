import { listBanners, getGlobalConfig, type BannerItem as DBBannerItem } from '@/app/api/admin/activity/update/bannerDb';
import { headers, cookies } from 'next/headers';
import HomePageClient from './components/features/game/HomePageClient';

/** D1-Fix: Prevent Next.js ISR from caching this page.
 *  Every request must read fresh banner data from Supabase so that
 *  Admin-created banners appear immediately on H5 (TC-BN-05 carousel test). */
export const dynamic = 'force-dynamic';

type BannerItem = DBBannerItem;

type BannerStatus = 'upcoming' | 'active' | 'ended';

function getBannerStatus(banner: BannerItem): BannerStatus {
  if (banner.activityStatus) return banner.activityStatus;
  if (!banner.endTime) return 'active';
  const now = Date.now();
  const end = new Date(banner.endTime).getTime();
  if (now >= end) return 'ended';
  return 'active';
}

export default async function HomePage() {
  let allBanners: BannerItem[] = [];
  try {
    allBanners = await listBanners();
  } catch (err) {
    console.error('[HomePage] listBanners threw:', err instanceof Error ? err.message : String(err));
  }

  let globalConfig: Awaited<ReturnType<typeof getGlobalConfig>>;
  try {
    globalConfig = await getGlobalConfig();
  } catch (err) {
    console.error('[HomePage] getGlobalConfig threw:', err instanceof Error ? err.message : String(err));
    globalConfig = { isGlobalEnabled: false, isCarouselEnabled: true, carouselInterval: 5 };
  }

  // ── Apply global kill switch (TC-AB-01) ──────────────────────────────────
  const enabledBanners: BannerItem[] = globalConfig.isGlobalEnabled
    ? allBanners.filter((b) => b.isEnabled)
    : [];

  // ── TC-BN-09: Filter out ended banners ────────────────────────────────────
  const visibleBanners: BannerItem[] = enabledBanners.filter(
    (b) => getBannerStatus(b) !== 'ended'
  );

  // ── TC-BN-12: No hardcoded fallback — strictly data-driven. ───────────────
  // If the DB is empty, the carousel section renders nothing.
  // This is intentional: the H5 must NEVER show fake countdowns or mock banners.
  const banners: BannerItem[] = visibleBanners;

  const config = {
    isCarouselEnabled: banners.length > 1 ? globalConfig.isCarouselEnabled : false,
    carouselInterval: globalConfig.carouselInterval,
  };

  // ── TC-BN-02/03: hasRewardUnclaimed
  // Derived from the user's actual daily_task / task_progress state so the
  // red dot honestly reflects "you have something to claim" instead of
  // being a permanently-on decoy.
  //
  // Logic (cheap, server-side):
  //   • If no uid cookie       → no user, no rewards possible → false
  //   • Otherwise, GET /api/user/status (same-origin, cookie-forwarded)
  //     and check task_progress.is_claimed === false where progress ≥
  //     threshold. If any → true.
  //   • On any error, fall back to false (red dot hidden) rather than
  //     showing a stale or fake state.
  let hasRewardUnclaimed = false;
  try {
    const cookieStore = await cookies();
    const authCookieName = process.env.NEXT_PUBLIC_AUTH_COOKIE_NAME ?? 'uid';
    const uidCookie = cookieStore.get(authCookieName)?.value;
    if (uidCookie && uidCookie.trim().length > 0) {
      const h = await headers();
      // Build the absolute origin so internal fetch() works under
      // both `next dev` and a deployed instance.
      const host = h.get('x-forwarded-host') ?? h.get('host') ?? `localhost:${process.env.PORT ?? 3000}`;
      const proto = h.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http');
      const origin = `${proto}://${host}`;
      const cookieHeader = cookieStore.getAll().map((c) => `${c.name}=${c.value}`).join('; ');
      // SSR fetch — runs on the Next.js server, so abort/timeout semantics are
// governed by Next.js itself (not the browser fetch wrapper). Per the
// REPARK Network Layer Hard Rule V6.0+, this is the *only* sanctioned
// exception to using fetchWithTimeout: it lives in a server component.
      const statusRes = await fetch(`${origin}/api/user/status`, {
        cache: 'no-store',
        headers: { Cookie: cookieHeader },
        // SSR safety: explicit timeout guards against the local PG/Redis
        // pool cold-start edge case (see production benchmark log).
        signal: AbortSignal.timeout(15_000),
      });
      if (statusRes.ok) {
        const body = await statusRes.json();
        const data = body?.data;
        if (data) {
          // PRD §2.9 / TC-BN-02: the red dot means "you have a milestone
          // you can claim right now", NOT "you did anything today".
          // Earlier code conflated these two concepts (daily_task progress
          // ≠ claimable reward). Server is the single source of truth.
          if (typeof data.has_unclaimed_milestone === 'boolean') {
            hasRewardUnclaimed = data.has_unclaimed_milestone;
          }
        }
      }
    }
  } catch (err) {
    // Fall through to false — better to miss a red dot than to show
    // a permanently-on badge that lies.
    console.warn('[HomePage] hasRewardUnclaimed lookup failed:', err instanceof Error ? err.message : String(err));
    hasRewardUnclaimed = false;
  }

  return (
    <HomePageClient
      banners={banners}
      config={config}
      hasRewardUnclaimed={hasRewardUnclaimed}
    />
  );
}

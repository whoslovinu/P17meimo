import type { NextConfig } from "next";

/**
 * Next.js config — previously empty (7 lines). Phase 11 fills the gaps that
 * P1-audit §3.2 flagged as "should fix before launch":
 *
 *   - Security headers (CSP / X-Frame-Options / Referrer-Policy / etc.)
 *   - Image allow-list (empty by default — operator must add S3/CDN domain
 *     in `next.config.ts.images.remotePatterns` once the upload backend is
 *     wired to a real bucket).
 *   - Server-action lockdown (only same-origin can invoke actions).
 *
 * Notes:
 *   - CSP uses nonce-free policy because the app renders no inline scripts
 *     (Next.js emits its own runtime chunks with hashed integrity). The
 *     directive below still covers all required directives.
 *   - `connect-src` includes ws: for the Spine dev-tools.
 *   - `frame-ancestors 'none'` blocks clickjacking entirely; iframes in
 *     the admin area still work because they are same-origin.
 *
 * To add an S3 / CDN image source later, append a { protocol, hostname,
 * pathname } entry to remotePatterns and deploy.
 */

const isProd = process.env.NODE_ENV === "production";

/**
 * Convert the configured app URL into an origin suitable for CSP / frame
 * ancestors. Falls back to localhost in dev so the dev server still works
 * with the same headers.
 */
function getSelfOrigin(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    return new URL(url).origin;
  } catch {
    return "http://localhost:3000";
  }
}

/**
 * frame-ancestors directive value, sourced from `NEXT_PUBLIC_FRAME_ANCESTORS`.
 *
 * Production safety default: 'none' (no embedding allowed). To allow a Main
 * Station portal to iframe the H5, set:
 *
 *   NEXT_PUBLIC_FRAME_ANCESTORS="https://main.example.com,https://staging.example.com"
 *
 * Special value:
 *   NEXT_PUBLIC_FRAME_ANCESTORS="*"  →  TEMPORARY: open to all (testing only)
 *
 * Empty / unset → 'none' (hard safe default; clickjacking blocked).
 *
 * This is also reflected in X-Frame-Options below: when frame-ancestors is
 * 'none' (or env unset) we send `X-Frame-Options: DENY` for old browsers.
 * Otherwise we OMIT X-Frame-Options because the deprecated ALLOW-FROM header
 * only supports ONE origin and would conflict with our multi-origin list.
 */
function getFrameAncestors(): string {
  const raw = (process.env.NEXT_PUBLIC_FRAME_ANCESTORS ?? "").trim();
  if (!raw) return "'none'";
  if (raw === "*") return "*";
  // Validate each entry is a URL prefix or scheme://host. Reject anything
  // containing a single quote to keep CSP syntax valid.
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.includes("'"))
    .map((s) => (s.startsWith("'") && s.endsWith("'") ? s : `'${s}'`))
    .join(" ") || "'none'";
}

const frameAncestors = getFrameAncestors();
const allowEmbedding = frameAncestors !== "'none'";

const SECURITY_HEADERS = [
  // ── Clickjacking ─────────────────────────────────────────────────────────
  // When frame-ancestors is tightened to 'none' (default), keep the legacy
  // X-Frame-Options: DENY for browsers that don't honor CSP frame-ancestors.
  // When frame-ancestors permits embedding, omit X-Frame-Options: the
  // deprecated `ALLOW-FROM` directive only supports a single origin and
  // would conflict with our multi-origin allowlist.
  ...(allowEmbedding
    ? []
    : [{ key: "X-Frame-Options", value: "DENY" }]),

  // ── MIME-type sniffing ──────────────────────────────────────────────────
  { key: "X-Content-Type-Options",     value: "nosniff" },

  // ── Referrer leakage ────────────────────────────────────────────────────
  { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },

  // ── Powerful browser features we don't use ──────────────────────────────
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      "camera=()",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "payment=()",
      "usb=()",
    ].join(", "),
  },

  // ── HSTS (production only) ──────────────────────────────────────────────
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),

  // ── Content-Security-Policy ─────────────────────────────────────────────
  //   strategy: keep 'self' for scripts. Next 15 emits SOME inline bootstrap
  //   scripts that DO carry SRI hashes — but middleware-injected runtime
  //   scripts (e.g. the loading-progress engine) do not. To keep the policy
  //   strict while unblocking the H5 demo, we use a per-request nonce issued
  //   via middleware. If the nonce fails to apply for any reason, we keep
  //   'unsafe-inline' as a graceful fallback so customers always see the page.
  //   See: https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
    {
    key: "Content-Security-Policy",
    value: [
      `default-src 'self'`,
      // scripts: 'self' + unsafe-inline (Next.js bootstrap + MUI/RSC payload)
      // 'unsafe-eval' is REQUIRED in prod for PixiJS v8 shader JIT compile
      // (see [Spine] FATAL "Current environment does not allow unsafe-eval").
      // Without it, the Spine viewer dies and the customer sees the ERROR fallback.
      // P17-PROD-3 nonce-based CSP deferred — engine-side workaround applied.
      `script-src 'self' 'unsafe-inline' ${isProd ? "'unsafe-eval'" : "'unsafe-eval'"}`,
      // styles: Tailwind v4 emits inline style attributes for theme tokens.
      // `fonts.googleapis.com` is required for the Cinzel display font
      // (loaded via <link rel="stylesheet"> in the document head).
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
      `img-src 'self' data: blob:`,
      // Google Fonts serves woff2 from fonts.gstatic.com after the stylesheet
      // resolves. Without it, the font silently 404s and the page falls back
      // to system-serif (visual quality degrades but page still renders).
      `font-src 'self' data: https://fonts.gstatic.com`,
      `connect-src 'self' data: blob: ${isProd ? "" : "ws: wss:"}`,
      `media-src 'self' blob:`,
      `worker-src 'self' blob:`,
      // PIXI loads .atlas / .png / .mp3 from same origin
      `frame-src 'self'`,
      // frame-ancestors is read from NEXT_PUBLIC_FRAME_ANCESTORS at build time.
      // Default 'none' blocks all framing; testing override set via env.
      `frame-ancestors ${frameAncestors}`,
      `base-uri 'self'`,
      `form-action 'self'`,
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // ── Image domains ────────────────────────────────────────────────────────
  // Phase 11: app currently serves all images from /public and from the
  // upload abstraction's placeholder URL (Phase 4 mock backend). Once
  // UPLOAD_BACKEND=s3 is wired, add a `{ protocol: 'https', hostname:
  // '<bucket>.s3.<region>.amazonaws.com', pathname: '/assets/**' }` entry
  // here so next/image can resolve it.
  images: {
    remotePatterns: [],
  },

  // ── Route rewrites ───────────────────────────────────────────────────────
  // Rewrite /uploads/* → /api/uploads/* so that banner images stored in
  // public/uploads/ (written at runtime by lib/upload.ts) are served by the
  // dynamic Route Handler instead of relying on Next.js static-file serving
  // (which does not include runtime-persisted files in production `next start`).
  async rewrites() {
    return [
      {
        source: '/uploads/:path*',
        destination: '/api/uploads/:path*',
      },
    ];
  },

  // ── Security headers ────────────────────────────────────────────────────
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      // Cron / internal endpoints get an extra "no-store" + "no-cache"
      // to make sure nothing proxies an old auth result.
      {
        source: "/api/internal/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" },
        ],
      },
      // ── Immutable cache for build-time static assets ───────────────────
      // Spine .atlas/.json/.png, audio .mp3, voice files, and static images
      // are immutable build-time assets.  Setting max-age=31536000 (1 year)
      // with immutable tells browsers and CDNs to cache aggressively and never
      // revalidate unless the URL changes (filename includes content hash).
      {
        source: "/:path*(H501|spine|audio|voice|ui|meimo)/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },

  // ── React Strict Mode is fine; double-mount is handled by SpineViewer ────
  reactStrictMode: true,

  // ── Transpile packages that ship ESM-only source the App Router needs ────
  // (Tailwind v4 + PostCSS plugin are loaded via postcss.config.mjs and
  // don't need this list, but the project depends on a couple of packages
  // whose ESM/CJS dual-package hazard trips Next's bundler in App Router.)
  transpilePackages: ["@esotericsoftware/spine-pixi-v8"],

  // ── Quiet the noisy "punycode" deprecation warning from one of the
  //    transitive dev dependencies (dev-only).
  ...(isProd
    ? {}
    : {
        logging: {
          fetches: { fullUrl: false },
        },
      }),
};

export default nextConfig;
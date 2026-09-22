import Link from 'next/link';

/**
 * app/not-found.tsx
 *
 * Root-level not-found page. Without this file Next.js falls back to the
 * built-in `/404` rendering pipeline, which currently crashes during
 * prerender in Next 15.5.14 + React 19.2.4 with:
 *   <Html> should not be imported outside of pages/_document.
 *
 * This file gives Next a route-bound 404 to use instead of the broken
 * built-in. It is intentionally minimal — the rest of the app already
 * has its own 404 UX inside individual route handlers (admin/login, etc.).
 *
 * IMPORTANT: do NOT export `dynamic = 'force-dynamic'` here. In Next
 * 15.5.x the build worker classifies `app/not-found.tsx` as "static 404"
 * only when no dynamic directive is present; force-dynamic makes it fall
 * through to the broken `/_error` Pages-Router prerender path that throws
 * "<Html> should not be imported outside of pages/_document".
 * See: https://github.com/vercel/next.js/issues/86177
 */

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        background: '#0a0a0f',
        color: '#f5f5f7',
      }}
    >
      <h1 style={{ fontSize: 72, margin: 0, color: '#FF2D87' }}>404</h1>
      <p style={{ marginTop: 12, opacity: 0.8 }}>
        页面走丢了 / Page not found
      </p>
      <Link
        href="/"
        style={{
          marginTop: 24,
          padding: '10px 20px',
          borderRadius: 999,
          background: '#FF2D87',
          color: '#fff',
          textDecoration: 'none',
          fontWeight: 600,
        }}
      >
        回到首页 / Home
      </Link>
    </main>
  );
}
'use client';

/**
 * app/global-error.tsx
 *
 * Root-level global error boundary. This is the *only* App-Router error
 * file allowed to render its own `<html>` and `<body>` tags.
 *
 * Without it, Next.js 15.5.x falls back to the internal `/_error` Pages
 * Router prerender path which crashes with:
 *   <Html> should not be imported outside of pages/_document.
 *   https://github.com/vercel/next.js/issues/86177
 *
 * `app/error.tsx` exists alongside this file for non-fatal runtime errors
 * inside the regular route tree; `global-error.tsx` covers the catastrophic
 * case where the root layout itself throws.
 *
 * It MUST be a client component (Next requirement).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  if (typeof window !== 'undefined') {
    console.error('[app/global-error.tsx]', error);
  }

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
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
        <h1 style={{ fontSize: 72, margin: 0, color: '#FF2D87' }}>500</h1>
        <p style={{ marginTop: 12, opacity: 0.8 }}>
          出错了，请稍后再试 / Something went wrong
        </p>
        {error.digest ? (
          <p style={{ marginTop: 8, fontSize: 12, opacity: 0.5 }}>
            ref: {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 24,
            padding: '10px 20px',
            borderRadius: 999,
            background: '#FF2D87',
            color: '#fff',
            border: 'none',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          重试 / Retry
        </button>
      </body>
    </html>
  );
}
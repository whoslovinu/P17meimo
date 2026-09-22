'use client';

/**
 * app/error.tsx
 *
 * Root-level error boundary. Without this file Next.js falls back to the
 * built-in `/500` rendering pipeline, which crashes during prerender in
 * Next 15.5.14 + React 19.2.4 with:
 *   <Html> should not be imported outside of pages/_document.
 *
 * This file gives Next a route-bound error page so the build succeeds.
 *
 * Why 'use client':
 *   - Next 15 requires error.tsx to be a client component (it needs to
 *     handle reset() interactively).
 *   - We never want to import any server-only code here.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Surface the digest in dev for debugging; log to console so it lands
  // in server logs if an upstream proxy forwards them.
  if (typeof window !== 'undefined') {
    console.error('[app/error.tsx]', error);
  }

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
    </main>
  );
}
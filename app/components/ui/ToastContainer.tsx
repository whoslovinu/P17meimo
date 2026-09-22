'use client';

import { useToastStore } from '@/app/lib/toastStore';

// ── Toast variant styles ────────────────────────────────────────────────────────
const VARIANT_STYLES = {
  info:    { bg: 'rgba(59,130,246,0.15)',  border: 'rgba(59,130,246,0.4)',   text: '#60A5FA', icon: 'ℹ️' },
  success: { bg: 'rgba(34,197,94,0.15)',   border: 'rgba(34,197,94,0.4)',    text: '#4ADE80', icon: '✅' },
  warning: { bg: 'rgba(251,191,36,0.15)',  border: 'rgba(251,191,36,0.4)',   text: '#FCD34D', icon: '⚠️' },
  error:   { bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.4)',    text: '#F87171', icon: '❌' },
};

function ToastItem({ id, message, variant }: { id: string; message: string; variant: keyof typeof VARIANT_STYLES }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const styles = VARIANT_STYLES[variant];

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer select-none"
      style={{
        background: styles.bg,
        border: `1px solid ${styles.border}`,
        color: styles.text,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        animation: 'toastIn 0.25s cubic-bezier(0.34,1.56,0.64,1)',
        boxShadow: `0 0 20px ${styles.border}`,
        maxWidth: '320px',
      }}
      onClick={() => removeToast(id)}
      title="点击关闭"
    >
      <span style={{ fontSize: '14px', flexShrink: 0 }}>{styles.icon}</span>
      <span className="text-sm font-medium flex-1 leading-tight">{message}</span>
      <button
        className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity ml-1"
        onClick={(e) => { e.stopPropagation(); removeToast(id); }}
        aria-label="关闭"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M10.354 1.646a.5.5 0 00-.707 0L6 5.293 2.354 1.646a.5.5 0 00-.707.707L5.293 6 1.646 9.646a.5.5 0 00.707.707L6 6.707l3.646 3.646a.5.5 0 00.707-.707L6.707 6l3.647-3.647a.5.5 0 000-.707z"/>
        </svg>
      </button>
    </div>
  );
}

/**
 * ToastContainer — renders all active toasts.
 * Place this once in the layout or BattleLayout root.
 * Uses a fixed stack anchored to the top-center of the viewport.
 */
export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <>
      <div
        className="fixed top-4 left-1/2 z-[20000] flex flex-col gap-2 pointer-events-none"
        style={{ transform: 'translateX(-50%)' }}
      >
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem id={t.id} message={t.message} variant={t.variant} />
          </div>
        ))}
      </div>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0)     scale(1); }
        }
      `}</style>
    </>
  );
}

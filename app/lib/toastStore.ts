'use client';

import { create } from 'zustand';

// ════════════════════════════════════════════════════════════════════════════════
// TOAST STORE — Zustand-powered global toast notification system
// Commercial-grade: typed payloads, queue, auto-dismiss, React 19 concurrent-safe.
// ════════════════════════════════════════════════════════════════════════════════

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number; // ms, defaults to 3000
}

interface ToastState {
  toasts: Toast[];
}

interface ToastActions {
  /** Add a toast. Returns the toast id. */
  addToast: (message: string, variant?: ToastVariant, duration?: number) => string;
  /** Remove a toast by id. Idempotent. */
  removeToast: (id: string) => void;
  /** Clear all toasts. */
  clearToasts: () => void;
}

type ToastStore = ToastState & ToastActions;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  addToast: (message: string, variant: ToastVariant = 'info', duration: number = 3000): string => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const toast: Toast = { id, message, variant, duration };
    set({ toasts: [...get().toasts, toast] });

    if (duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, duration);
    }

    return id;
  },

  removeToast: (id: string): void => {
    const before = get().toasts.length;
    const next = get().toasts.filter((t) => t.id !== id);
    if (next.length !== before) {
      set({ toasts: next });
    }
  },

  clearToasts: (): void => {
    set({ toasts: [] });
  },
}));

// ── Convenience wrappers ───────────────────────────────────────────────────────
export const toast = {
  info:    (msg: string, duration?: number) => useToastStore.getState().addToast(msg, 'info',    duration ?? 3000),
  success: (msg: string, duration?: number) => useToastStore.getState().addToast(msg, 'success', duration ?? 3000),
  warning: (msg: string, duration?: number) => useToastStore.getState().addToast(msg, 'warning', duration ?? 4000),
  error:   (msg: string, duration?: number) => useToastStore.getState().addToast(msg, 'error',   duration ?? 5000),
};

// ── Legacy compat ─────────────────────────────────────────────────────────────
export const addToast    = (msg: string, v?: ToastVariant, d?: number) => useToastStore.getState().addToast(msg, v, d);
export const removeToast = (id: string) => useToastStore.getState().removeToast(id);
export const clearToasts = () => useToastStore.getState().clearToasts();

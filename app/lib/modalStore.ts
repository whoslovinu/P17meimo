'use client';

import { create } from 'zustand';

// ════════════════════════════════════════════════════════════════════════════════
// MODAL STORE — Zustand-powered global state
// Safe for React 19 concurrent mode. No module-level mutable variables.
//
// V1.6 history:
//   - 2026-07-23: customer reported "每日任务 / 进度奖励 弹窗反复弹出".
//     Investigation found that an early prototype used a 1000ms cooldown
//     (intended to coalesce bubbling click events) combined with a
//     lastActionTime written by closeModal. Under heavy event bursts this
//     could leave the modal stuck OR visibly flicker, depending on timing.
//     The cooldown was the only rate limiter; closeModal writing
//     lastActionTime meant rapid open/close/open cycles were partially
//     suppressed. There was also no deduplication: every open request set
//     `page` even when the page was already equal to the desired value,
//     causing React to re-mount the entire SubPageModal subtree on each
//     seemingly idempotent open.
//
//   - 2026-07-23 fix:
//     1. Drop the 1000ms cooldown entirely — its only function was to mask
//        bubbling click events, but the proper guard against bubbling is
//        `stopPropagation` in the click handler (already in place).
//     2. Drop lastActionTime mutation on close.
//     3. Deduplicate open: if the desired page equals the currently open
//        page, do nothing. This is the real fix for "弹窗反复弹出" — a
//        bubbling click will not re-mount an already-open modal.
//     4. Stamp every open request with a monotonically increasing
//        `requestId` so we can log the chain of opens side-by-side with
//        mount/unmount events from SubPageModal.
//     5. Emit an explicit stack trace on every transition for diagnosis.
// ════════════════════════════════════════════════════════════════════════════════

export type ModalPage = 'task' | 'reward' | 'rules' | 'leaderboard';

interface ModalState {
  /** The currently open modal page, or null if none is open. */
  page: ModalPage | null;
  /** Monotonic counter incremented on every accepted open request. */
  requestId: number;
  /** Whether the store is ready (always true after mount). */
  isReady: boolean;
}

interface ModalActions {
  /** Opens a modal. No-op if the same page is already open. */
  openModal: (page: ModalPage) => void;
  /** Closes the active modal. No-op if already closed. */
  closeModal: () => void;
}

type ModalStore = ModalState & ModalActions;

export const useModalStore = create<ModalStore>((set, get) => ({
  page: null,
  requestId: 0,
  isReady: false,

  openModal: (page: ModalPage) => {
    const current = get().page;
    if (current === page) {
      // Already showing the requested page — this is the bug that caused
      // "反复弹出": a bubbling click that hit `openModal` a second or
      // third time used to trigger a re-mount of SubPageModal. We now
      // explicitly no-op so React sees an unchanged store and keeps the
      // existing subtree mounted.
      console.log(`[modalStore] openModal NO-OP (already open: ${page})`);
      return;
    }
    if (current !== null && current !== page) {
      console.log(`[modalStore] openModal: replacing ${current} with ${page}`);
    } else {
      console.log(`[modalStore] openModal: → ${page}`);
    }
    const nextId = get().requestId + 1;
    if (typeof window !== 'undefined') {
      console.log(`[modalStore] requestId=${nextId} stack:\n${new Error().stack ?? '(no stack)'}`);
    }
    set({ page, requestId: nextId });
  },

  closeModal: () => {
    if (get().page === null) return;
    console.log(`[modalStore] closeModal: → null`);
    set({ page: null });
  },
}));

// ── Legacy compat ─────────────────────────────────────────────────────────────
// Keep the raw actions exported so existing call sites don't need refactoring.
export const openModal = (page: ModalPage) => useModalStore.getState().openModal(page);
export const closeModal = () => useModalStore.getState().closeModal();

'use client';

import { create } from 'zustand';

/**
 * Global navigation transition state.
 * Set `isTransitioning = true` before navigating away from the home page;
 * the home page renders a full-screen overlay while the battle page loads.
 * BattleLayout / LoadingScreen sets it back to false on mount.
 */
interface TransitionState {
  isTransitioning: boolean;
  setTransitioning: (val: boolean) => void;
}

export const useTransitionStore = create<TransitionState>((set) => ({
  isTransitioning: false,
  setTransitioning: (val) => set({ isTransitioning: val }),
}));

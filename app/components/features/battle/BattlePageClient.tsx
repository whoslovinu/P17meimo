'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

interface SpineConfig {
  spineBaseUrl: string;
  formThresholds: { stage2: number; stage3: number; stage4: number };
}

interface GameItemsConfig {
  propA: { name: string; rows: Array<{ minDamage: number; maxDamage: number; probability: number }>; taskThreshold: number; dailyLimit: number };
  propB: { name: string; rows: Array<{ minDamage: number; maxDamage: number; probability: number }>; taskThreshold: number; dailyLimit: number };
}

interface GameMilestone {
  id:         string;
  threshold:  number;
  rewardType: 'ENERGY' | 'MEDAL';
  energyValue?: number;
  medalId?:   string;
}

interface BattleLayoutProps {
  initialHp?: { current: number; max: number };
  initialInventory?: { item_hand: number; item_phallus: number };
  spineConfig?: SpineConfig | null;
  gameItems?: GameItemsConfig | null;
  gameMilestones?: GameMilestone[] | null;
}

// Dynamically import BattleLayout with SSR disabled.
// ssr:false means Next.js never renders this on the server, eliminating
// the ~10s SSR blocking caused by Next.js's internal request queue
// serialization when BattleLayout's module graph is loaded server-side.
//
// No `loading` fallback is provided — Next.js renders nothing during chunk
// download. BattleLayout's own LoadingScreen takes over the moment it mounts.
const BattleLayout = dynamic<BattleLayoutProps>(
  () => import('./BattleLayout').then(m => m.BattleLayout),
  { ssr: false }
);

// Client wrapper that can receive props and render BattleLayout.
// This replaces the 'use server' battle/page.tsx which caused SSR blocking.
export function BattlePageClient(props: BattleLayoutProps) {
  return (
    <div className="w-screen h-screen bg-[#000000] overflow-hidden">
      <BattleLayout {...props} />
    </div>
  );
}

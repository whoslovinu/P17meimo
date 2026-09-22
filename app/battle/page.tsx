export const dynamic = 'force-dynamic';
export const revalidate = 0;

// BattlePageClient is a Client Component that uses next/dynamic to render
// BattleLayout with ssr:false. This eliminates the ~10s SSR blocking
// caused by Next.js's internal request queue serialization on `next start`.
import { BattlePageClient } from '@/app/components/features/battle/BattlePageClient';

// Server-side defaults — the LoadingScreen inside BattleLayout handles
// real data fetching client-side once the page hydrates.
const DEFAULT_HP = { current: 100000, max: 100000 };
const DEFAULT_INVENTORY = { item_hand: 3, item_phallus: 3 };

export default function BattlePage() {
  return (
    <BattlePageClient
      initialHp={DEFAULT_HP}
      initialInventory={DEFAULT_INVENTORY}
      spineConfig={null}
      gameItems={null}
      gameMilestones={null}
    />
  );
}

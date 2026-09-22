'use client';

import { useEffect, useState } from 'react';
import { GameBannerCarousel } from './GameBannerCarousel';
import { useRewardStore } from '@/lib/rewardStore';

interface BannerItem {
  id: string;
  imageUrl: string;
  targetActivityId: string | null;
  activityName: string | null;
  sortWeight: number;
  isEnabled: boolean;
  showCountdown: boolean;
  activityStatus?: 'upcoming' | 'active' | 'ended';
  endTime?: string;
}

interface CarouselConfig {
  isCarouselEnabled: boolean;
  carouselInterval: number;
}

interface HomePageClientProps {
  banners: BannerItem[];
  config: CarouselConfig;
  /**
   * True when the authenticated user has at least one unclaimed task or
   * milestone reward. Passed from the server component so it renders
   * correctly on first load before any client-side state.
   */
  hasRewardUnclaimed?: boolean;
}

type Tab = 'hot' | 'new';

const NAV_ITEMS = [
  { id: 'home', label: '首页', icon: 'home' },
  { id: 'chat', label: '聊天', icon: 'chat' },
  { id: 'claim', label: '领电量', icon: 'claim' },
  { id: 'mine', label: '我的', icon: 'mine' },
];

function NavIcon({ id, active }: { id: string; active: boolean }) {
  const color = active ? '#FF2D87' : 'rgba(255,255,255,0.4)';
  if (id === 'home') return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill={color}>
      <path d="M11 2L2 9.5V20h6v-6h2v6h6V9.5L11 2z" />
    </svg>
  );
  if (id === 'chat') return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill={color}>
      <path d="M4 4h14a2 2 0 012 2v8a2 2 0 01-2 2H6l-4 4V6a2 2 0 012-2z" />
    </svg>
  );
  if (id === 'claim') return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill={color}>
      <path d="M11 2v8H3a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2v-6a2 2 0 00-2-2h-8V2l-3 4z" />
    </svg>
  );
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill={color}>
      <circle cx="11" cy="7" r="3.5" />
      <path d="M3 19c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

export default function HomePageClient({ banners, config, hasRewardUnclaimed = false }: HomePageClientProps) {
  const [activeTab, setActiveTab] = useState<Tab>('hot');

  // TC-BN-03: 首页 TabBar 红点 — 直接读 SSR 传下来的 server-truth。
  // 后续如果领电量面板需要即时抹掉红点，可以再 hydrate 进 store。
  const hasHomeRedDot = hasRewardUnclaimed;

  // Hydrate reward store from server-rendered value on first mount
  useEffect(() => {
    useRewardStore.getState().hydrateFromServer(hasRewardUnclaimed ? 1 : 0);
  }, [hasRewardUnclaimed]);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: '#0A0A12' }}
    >
      {/* ── Top Nav ──────────────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-4 pt-4 pb-3 sticky top-0 z-20"
        style={{ background: '#0A0A12' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center rounded-lg text-white font-black"
            style={{
              width: 32,
              height: 32,
              background: 'linear-gradient(135deg, #FF6B35, #FFB347)',
              fontSize: 14,
            }}
          >
            M
          </div>
          <span className="text-white font-bold text-sm tracking-widest">
            MEIMODU
          </span>
        </div>

        {/* Tab group */}
        <div
          className="flex items-center rounded-full px-1 py-1 gap-0.5"
          style={{ background: 'rgba(255,255,255,0.05)' }}
        >
          {[
            { id: 'new' as Tab, label: '最新' },
            { id: 'hot' as Tab, label: '最热', highlight: true },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="px-3 py-1 rounded-full text-xs font-semibold transition-all duration-200"
              style={
                activeTab === tab.id
                  ? tab.highlight
                    ? { background: '#FF2D87', color: 'white', boxShadow: '0 0 8px rgba(255,45,135,0.4)' }
                    : { background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }
                  : { background: 'transparent', color: 'rgba(255,255,255,0.35)' }
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Right icon */}
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full"
          style={{ background: 'rgba(255,255,255,0.06)' }}
          aria-label="榜单"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 3h12M2 8h8M2 13h10"
              stroke="rgba(255,255,255,0.5)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide">
        {['全部', '原创', '二创', '活动', '榜单', '收藏'].map((label, i) => (
          <button
            key={label}
            className="flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-150"
            style={
              i === 0
                ? { background: '#FF2D87', color: 'white' }
                : {
                    background: 'rgba(255,255,255,0.06)',
                    color: 'rgba(255,255,255,0.45)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="flex-1 px-4 pb-24 space-y-4 overflow-y-auto">
        {/* Banner Carousel — only renders if banners exist and global switch is on */}
        {banners.length > 0 && (
          <div className="pt-1">
            <GameBannerCarousel banners={banners} config={config} />
          </div>
        )}

        {/* Content cards grid */}
        <div className="grid grid-cols-2 gap-3">
          {[
            {
              tag: '原创',
              title: 'Emilie — 深渊魅魔的艺术重塑',
              author: '画师零',
              likes: '2.3k',
              gradient: 'linear-gradient(135deg, #1A1225, #1E0E1E)',
              border: '#FF2D87',
            },
            {
              tag: '二创',
              title: '闪电符文高效获取路线图',
              author: '攻略组',
              likes: '890',
              gradient: 'linear-gradient(135deg, #0E1A1E, #0E1E1A)',
              border: '#238636',
            },
            {
              tag: '原创',
              title: 'BOSS弱点解析 · 第四阶段',
              author: '数据组',
              likes: '1.1k',
              gradient: 'linear-gradient(135deg, #1A1A0E, #1E1E0E)',
              border: '#9B5CFF',
            },
            {
              tag: '活动',
              title: '全服首杀记录刷新 · 奖励公示',
              author: '官方',
              likes: '3.5k',
              gradient: 'linear-gradient(135deg, #1A0E1E, #1E0E1A)',
              border: '#FFB347',
            },
          ].map((card, i) => (
            <div
              key={i}
              className="rounded-xl overflow-hidden cursor-pointer transition-transform active:scale-95"
              style={{
                background: card.gradient,
                border: `1px solid ${card.border}40`,
                boxShadow: `0 0 12px ${card.border}15`,
              }}
            >
              <div
                className="w-full aspect-square flex items-center justify-center"
                style={{ background: `${card.border}15` }}
              >
                <span className="text-4xl font-black" style={{ color: `${card.border}60` }}>
                  M
                </span>
              </div>
              <div className="p-2.5">
                <span
                  className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-sm mb-1"
                  style={{ background: `${card.border}25`, color: card.border }}
                >
                  {card.tag}
                </span>
                <p className="text-[11px] font-semibold text-white/90 leading-snug line-clamp-2 mb-1">
                  {card.title}
                </p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    @{card.author}
                  </span>
                  <span className="text-[10px] font-medium" style={{ color: card.border }}>
                    ♥ {card.likes}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* ── Bottom Nav ───────────────────────────────────────────────────── */}
      <nav
        className="fixed bottom-0 left-0 right-0 flex items-center justify-around py-3 z-30"
        style={{
          background: 'rgba(10,10,18,0.92)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === 'home';
          // TC-BN-03: 仅"首页"图标展示红点；未登录/无奖励时不渲染
          const showRedDot = item.id === 'home' && hasHomeRedDot;
          return (
            <button
              key={item.id}
              className="flex flex-col items-center gap-0.5 min-w-[48px] relative"
              style={{ color: isActive ? '#FF2D87' : 'rgba(255,255,255,0.3)' }}
            >
              <div className="relative">
                <NavIcon id={item.id} active={isActive} />
                {showRedDot && (
                  <span
                    aria-label="首页有待领取内容"
                    data-testid="home-red-dot"
                    className="absolute rounded-full"
                    style={{
                      top: -1,
                      right: -2,
                      width: 7,
                      height: 7,
                      background: '#FF2D87',
                      boxShadow: '0 0 4px rgba(255,45,135,0.8)',
                    }}
                  />
                )}
              </div>
              <span className="text-[10px] font-medium">{item.label}</span>
              {isActive && (
                <div
                  className="w-1 h-1 rounded-full mt-0.5"
                  style={{ background: '#FF2D87' }}
                />
              )}
            </button>
          );
        })}
      </nav>

    </div>
  );
}

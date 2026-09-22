'use client';

import { Lock } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────────
export type FormId = 'initial' | 'awakening' | 'flame' | 'shadow';

export interface FormConfig {
  id: FormId;
  name: string;
  /** Roman numeral label — rendered with Cinzel gold gradient */
  roman: string;
  IconComponent: React.ComponentType<{ size?: number; className?: string }>;
  unlockThreshold: number;
  glowColor: string;
}

export const FORM_CONFIGS: FormConfig[] = [
  { id: 'initial',    name: '一阶段', roman: 'Ⅰ', IconComponent: () => null, unlockThreshold: 100, glowColor: '#00D4FF' },
  { id: 'awakening',  name: '二阶段', roman: 'Ⅱ', IconComponent: () => null, unlockThreshold: 75, glowColor: '#FF69B4' },
  { id: 'flame',      name: '三阶段', roman: 'Ⅲ', IconComponent: () => null, unlockThreshold: 50, glowColor: '#FF6B35' },
  { id: 'shadow',     name: '四阶段', roman: 'Ⅳ', IconComponent: () => null, unlockThreshold: 25, glowColor: '#9B5CFF' },
];

export function buildFormConfigs(
  thresholds: { stage2: number; stage3: number; stage4: number } | null,
): FormConfig[] {
  const t = thresholds ?? { stage2: 75, stage3: 50, stage4: 25 };
  return [
    { id: 'initial',    name: '一阶段', roman: 'Ⅰ', IconComponent: () => null, unlockThreshold: 100,             glowColor: '#00D4FF' },
    { id: 'awakening',  name: '二阶段', roman: 'Ⅱ', IconComponent: () => null, unlockThreshold: t.stage2,         glowColor: '#FF69B4' },
    { id: 'flame',      name: '三阶段', roman: 'Ⅲ', IconComponent: () => null, unlockThreshold: t.stage3,         glowColor: '#FF6B35' },
    { id: 'shadow',     name: '四阶段', roman: 'Ⅳ', IconComponent: () => null, unlockThreshold: t.stage4,         glowColor: '#9B5CFF' },
  ];
}

// ── Shared props base ───────────────────────────────────────────────────────────
interface FormSelectorBaseProps {
  activeForm: FormId;
  onSelectForm: (formId: FormId) => void;
  formConfigs?: FormConfig[];
}

interface FormSelectorWithLockProps extends FormSelectorBaseProps {
  /**
   * REMOVED (2026-09-18): HP percent is no longer used for unlock logic.
   * Kept for display purposes only (future: show HP % next to each stage).
   * Pass any value or omit — it will be ignored.
   */
  hpPercent?: number;
  unlockedForms: Set<FormId>;
  /**
   * When true, the entire selector is grayed out and clicks are ignored.
   * Used by BattleLayout while a Spine attack / standby animation is playing
   * so the operator can't switch form mid-strike.
   */
  disabled?: boolean;
}

// ── Cinzel Roman Numeral Badge ────────────────────────────────────────────────
// Renders the Roman numeral with a metallic gold gradient + purple glow.
// Uses 'Cinzel' font (loaded via global CSS or Google Fonts fallback).
function CinzelBadge({ roman, glowColor, size = 14 }: { roman: string; glowColor: string; size?: number }) {
  return (
    <div
      className="select-none"
      style={{
        fontFamily: "'Cinzel', 'Playfair Display', 'Times New Roman', serif",
        fontSize: `${size}px`,
        fontWeight: 700,
        lineHeight: 1,
        background: 'linear-gradient(135deg, #FDE047 0%, #FF8C00 30%, #FDE047 50%, #CA8A04 75%, #FDE047 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        filter: `drop-shadow(0 0 6px ${glowColor}88) drop-shadow(0 0 2px ${glowColor}44)`,
        letterSpacing: '0.02em',
      }}
    >
      {roman}
    </div>
  );
}

// ── Base selector (no lock logic) ────────────────────────────────────────────────
export function FormSelector({
  activeForm,
  onSelectForm,
  formConfigs,
}: FormSelectorBaseProps) {
  const configs = formConfigs ?? FORM_CONFIGS;
  return (
    <div className="absolute right-0 sm:right-2 top-1/2 -translate-y-1/2 z-[100] flex flex-col gap-1.5 sm:gap-3 pointer-events-auto">
      {configs.map((form) => (
        <FormButton
          key={form.id}
          form={form}
          isActive={form.id === activeForm}
          isLocked={false}
          onSelect={onSelectForm}
        />
      ))}
    </div>
  );
}

// ── Selector with lock state ───────────────────────────────────────────────────
export function FormSelectorWithLock({
  hpPercent: _hpPercent,
  activeForm,
  unlockedForms,
  onSelectForm,
  formConfigs,
  disabled = false,
}: FormSelectorWithLockProps) {
  const configs = formConfigs ?? FORM_CONFIGS;
  // REPARK 7.0 (2026-09-18 round 2): hpPercent prop is REMOVED from unlock logic.
  // Selector unlock state is derived exclusively from unlockedForms (set by server).
  // formConfigs thresholds are used ONLY for display labels, NOT for unlock gate.
  // This eliminates the last independent HP-to-unlock bridge on the client side.
  return (
    <div
      // Mobile-first: stack buttons tight against the right edge with a 50% scale
      // ── UI Routing ────────────────────────────────────────────────────────────
      // Outer container is a slim side rail. Button size is set inside <FormButton>
      // via responsive clamp(). No container-scaling hack (scale-50 was shrinking
      // mobile buttons — the wrong direction). Mobile = chunky, desktop = slim.
      className="absolute right-1 sm:right-3 top-1/2 -translate-y-1/2 z-[100] flex flex-col gap-2 sm:gap-2 pointer-events-auto origin-right"
      style={{
        opacity: disabled ? 0.35 : 1,
        filter: disabled ? 'saturate(0.3) blur(0.3px)' : 'none',
        transition: 'opacity 0.2s, filter 0.2s',
        pointerEvents: disabled ? ('none' as const) : ('auto' as const),
      }}
    >
      {configs.map((form) => {
        const isActive = form.id === activeForm;
        // REPARK 7.0 (2026-09-18 round 2): unlock state is EXCLUSIVELY from
        // the server-derived unlockedForms Set. No HP-based override.
        const isUnlocked = unlockedForms.has(form.id);
        const isLocked = !isUnlocked || disabled;

        return (
          <FormButton
            key={form.id}
            form={form}
            isActive={isActive}
            isLocked={isLocked}
            onSelect={(id) => {
              if (disabled || isLocked) return;
              (window as Window & { triggerFormSwitchFlash?: () => void }).triggerFormSwitchFlash?.();
              onSelectForm(id);
            }}
          />
        );
      })}
    </div>
  );
}

// ── Individual form button (UI 2.0 — Cinzel Roman numerals) ───────────────────
interface FormButtonProps {
  form: FormConfig;
  isActive: boolean;
  isLocked: boolean;
  onSelect: (id: FormId) => void;
}

function FormButton({ form, isActive, isLocked, onSelect }: FormButtonProps) {
  return (
    <button
      onClick={() => onSelect(form.id)}
      disabled={isLocked}
      className={`
        relative flex flex-col items-center justify-center
        transition-all duration-200 select-none rounded-xl
        ${isLocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:scale-110 active:scale-95'}
        ${isActive ? 'scale-105' : ''}
      `}
      style={{
        // Mobile: chunky 60px tap targets. Desktop: tighter 48px to leave room for spine.
        width: 'clamp(48px, 8vw, 60px)',
        height: 'clamp(48px, 8vw, 60px)',
        minWidth: '48px',
        minHeight: '48px',
        background: isLocked
          ? 'rgba(255,255,255,0.06)'
          : isActive
          ? `linear-gradient(135deg, ${form.glowColor}22, ${form.glowColor}11)`
          : 'rgba(255,255,255,0.04)',
        border: isActive
          ? `1.5px solid ${form.glowColor}`
          : isLocked
          ? '1px solid rgba(255,255,255,0.15)'
          : '1px solid rgba(255,255,255,0.08)',
        boxShadow: isActive
          ? `0 0 16px ${form.glowColor}66, 0 0 32px ${form.glowColor}22`
          : 'none',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        touchAction: 'manipulation',
        gap: 0,
      }}
    >
      {isLocked && (
        <div
          className="absolute inset-0 flex items-center justify-center rounded-xl z-10"
          style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
        >
          <Lock size={11} color="rgba(255,255,255,0.25)" />
        </div>
      )}

      {isActive && !isLocked && (
        <div
          className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full"
          style={{ background: form.glowColor, boxShadow: `0 0 6px ${form.glowColor}` }}
        />
      )}

      {/* Cinzel Roman numeral — the primary visual element */}
      <CinzelBadge roman={form.roman} glowColor={form.glowColor} size={16} />

      {/* Stage name in small text below */}
      <span
        className="text-[9px] sm:text-[10px] font-medium leading-tight mt-[1px]"
        style={{ color: isActive ? form.glowColor : 'rgba(255,255,255,0.3)' }}
      >
        {form.name}
      </span>
    </button>
  );
}

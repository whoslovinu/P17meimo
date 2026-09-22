'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronLeft, Save, RefreshCw, AlertTriangle, CheckCircle, XCircle, Plus, Zap,
  Activity, Package, Flag, X, Image, User
} from 'lucide-react';
import { adminFetch } from '@/app/admin/lib/adminApi';
import type {
  CharacterBioItem,
  CharacterSkillItem,
} from '@/app/lib/characterProfile';
import {
  DEFAULT_BIO,
  DEFAULT_SKILLS,
  DEFAULT_STAGE_NAMES,
} from '@/app/lib/characterProfile';

interface BannerItem {
  id: string;
  imageUrl: string;
  targetActivityId: string | null;
  sortWeight: number;
  isEnabled: boolean;
  showCountdown: boolean;
  createdAt: string;
}

// ── Shared Types ───────────────────────────────────────────────────────────────────
type ActivityType   = 'LIVE2D' | 'ENERGY';
type ActivityStatus = 'ENABLED' | 'DISABLED';
type RewardType    = 'ENERGY' | 'MEDAL';

interface DamageRow {
  id:          string;
  minDamage:   number;
  maxDamage:   number;
  probability: number;
}

interface ItemTier {
  name:          string;
  rows:          DamageRow[];
  taskThreshold: number;
  dailyLimit:   number;
}

interface ItemConfig {
  propA: ItemTier;
  propB: ItemTier;
}

interface Milestone {
  id:         string;
  threshold:  number;
  rewardType: RewardType;
  energyValue?: number;
  medalId?:   string;
}

interface ActivityBoss {
  totalHp:   number;
  currentHp: number;
}

interface BadgeInfo {
  badge_id:    string;
  name:        string;
  thumbnail:   string;  // maps from getBadgeDetail().icon
  description: string;
}

// ── Spine Config — threshold only (forms/morphs removed) ────────────────────

interface SpineFormThresholds {
  stage2: number;
  stage3: number;
  stage4: number;
}

interface SpineConfig {
  formThresholds: SpineFormThresholds;
}

interface ActivityConfig {
  isGlobalEnabled: boolean;
  rules:          string;
  boss:          ActivityBoss;
  items:         ItemConfig;
  milestones:     Milestone[];
  spine:         SpineConfig;
  // REPARK 6.0 (2026-08-14): optional character profile block. Drives the H5
  // `CharacterIntroPanel` (stage names / bio / skills). Optional so older
  // rows keep loading untouched.
  character_profile?: {
    characterName?: string;
    stageNames?: string[];
    stageColors?: { className?: string }[];
    bio?: CharacterBioItem[];
    skills?: CharacterSkillItem[];
  };
  // REPARK 7.0 Batch C (2026-08-28): customer-requested 每日自动重置 toggle.
  // Backward-compatible — undefined / missing means ON (default behaviour).
  dailyReset?: {
    enabled: boolean;
  };
}

interface Activity {
  id:         number;
  name:       string;
  type:       ActivityType;
  start_time: string;
  end_time:   string;
  status:     ActivityStatus;
  config:     ActivityConfig;
  created_at: string;
}

interface FormData {
  name:           string;
  start_time:      string;
  end_time:        string;
  isGlobalEnabled: boolean;
  rules:          string;
  totalHp:       number;
  currentHp:      number;
  propA:          ItemTier;
  propB:          ItemTier;
  milestones:     Milestone[];
  spine:         SpineConfig;
  // REPARK 6.0 (2026-08-14): character profile sub-form. Authored as 4 stage
  // names + dynamic bio rows + dynamic skill rows. Default state mirrors the
  // H5 hardcoded values so the form is meaningful even on day one.
  characterProfile: {
    characterName: string;
    stageNames: string[];
    bio: CharacterBioItem[];
    skills: CharacterSkillItem[];
  };
  // REPARK 7.0 Batch C (2026-08-28): 每日自动重置 toggle. Default ON to
  // match the production-default behaviour (legacy activities without the
  // field behave exactly as today).
  dailyResetEnabled: boolean;
}

interface ValidationErrors {
  name?:          string;
  start_time?:    string;
  end_time?:      string;
  totalHp?:      string;
  currentHp?:    string;
  propA?:        string;
  propB?:        string;
  milestones?:    Record<string, string>;
  spine?:        string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateUniqueMilestoneId(existing: Array<{ id?: string | number }>): string {
  const baseTimestamp = Math.floor(Date.now() / 1000);
  let targetId = `m${baseTimestamp}`;

  // 若当前秒已存在该 ID，则向上递增直到唯一
  const existingIdSet = new Set(existing.map((item) => String(item.id ?? '').trim()));
  let offset = 0;
  while (existingIdSet.has(targetId)) {
    offset += 1;
    targetId = `m${baseTimestamp + offset}`;
  }

  return targetId;
}

let _rowCounter = 100;
function newRowId(): string { return `r${++_rowCounter}`; }

function defaultPropRows(): DamageRow[] {
  return [
    { id: newRowId(), minDamage: 1,  maxDamage: 3,  probability: 50 },
    { id: newRowId(), minDamage: 4,  maxDamage: 5,  probability: 50 },
  ];
}

function defaultTier(name: string, taskThreshold = 100, dailyLimit = 5): ItemTier {
  return { name, rows: defaultPropRows(), taskThreshold, dailyLimit };
}

function defaultSpine(): SpineConfig {
  return { formThresholds: { stage2: 75, stage3: 50, stage4: 25 } };
}

// REPARK 6.0 (2026-08-14): default state for the character profile sub-form.
// Mirrors `CharacterIntroPanel`'s day-one hardcoded values so a freshly-
// created activity still has sensible content.
function defaultCharacterProfile(): FormData['characterProfile'] {
  return {
    characterName: '深渊魅魔',
    stageNames: [...DEFAULT_STAGE_NAMES],
    bio: DEFAULT_BIO.map((b) => ({ ...b })),
    skills: DEFAULT_SKILLS.map((s) => ({ ...s })),
  };
}

let _bioCounter = 200;
let _skillCounter = 200;

function newBioId(): string { return `b${++_bioCounter}`; }
function newSkillId(): string { return `s${++_skillCounter}`; }


// Maps a FormData field key to its human-readable Chinese label.
// Used by the form wayfinding toast so the Commander knows WHICH fields
// are broken, not just that "something is wrong".
const FIELD_LABEL: Record<string, string> = {
  name:       '活动名称',
  start_time: '活动开始时间',
  end_time:   '活动结束时间',
  totalHp:    'Boss 总血量',
  currentHp:  'Boss 当前血量',
  propA:      '闪电符文概率总和',
  propB:      '潮汐晶石概率总和',
  milestones: '进度奖励',
};

// Maps a field key to the scrollable section ID that contains it.
// When validation fails, we auto-scroll to the FIRST broken section so
// the Commander doesn't have to hunt through the form.
const FIELD_TO_SECTION: Record<string, string> = {
  name:        'section-basic',
  start_time:  'section-basic',
  end_time:    'section-basic',
  totalHp:     'section-boss',
  currentHp:   'section-boss',
  propA:       'section-items',
  propB:       'section-items',
  milestones:  'section-milestones',
};

function calcSum(rows: DamageRow[]): number {
  return rows.reduce((s, r) => s + (r.probability || 0), 0);
}

// Module-level constants for ScrollSpy — avoids exhaustive-deps warning
const SCROLLSPY_SECTIONS = ['section-basic', 'section-boss', 'section-items', 'section-milestones', 'section-profile', 'section-banners'] as const;

function findDuplicateThresholds(ms: Milestone[]): Record<string, string> {
  const counts: Record<number, string[]> = {};
  ms.forEach((m) => {
    if (!counts[m.threshold]) counts[m.threshold] = [];
    counts[m.threshold].push(m.id);
  });
  const errs: Record<string, string> = {};
  Object.values(counts).forEach((ids) => {
    if (ids.length > 1) {
      ids.forEach((id) => {
        errs[id] = '个人累计伤害要求不能重复';
      });
    }
  });
  return errs;
}

function findDuplicateIds(ms: Milestone[]): Record<string, string> {
  const seen: Record<string, number> = {};
  const errs: Record<string, string> = {};
  ms.forEach((m) => {
    const key = String(m.id ?? '');
    if (!key) return;
    seen[key] = (seen[key] ?? 0) + 1;
  });
  Object.entries(seen).forEach(([id, count]) => {
    if (count > 1) errs[id] = '里程碑 ID 不能重复';
  });
  return errs;
}

// ── Toast ───────────────────────────────────────────────────────────────────────
interface ToastMsg { type: 'success' | 'error' | 'warning'; message: string }

function Toast({ toast }: { toast: ToastMsg | null }) {
  if (!toast) return null;
  const colors = {
    success: 'bg-emerald-500/90 text-white',
    error:   'bg-red-500/90 text-white',
    warning: 'bg-amber-500/90 text-white',
  };
  const Icon = toast.type === 'success' ? CheckCircle
    : toast.type === 'error' ? XCircle
    : AlertTriangle;
  return (
    <div className={`fixed top-4 right-4 z-[200] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 ${colors[toast.type]}`}>
      <Icon size={18} />
      <span className="text-sm font-medium">{toast.message}</span>
    </div>
  );
}

// ── Segmented Probability Distribution Bar ───────────────────────────────────
interface SegProbBarProps {
  rows: DamageRow[];
}

function SegProbBar({ rows }: SegProbBarProps) {
  const sum = calcSum(rows);
  const isOk = Math.abs(sum - 100) < 0.001;

  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>概率分布</span>
        <span className={isOk ? 'text-emerald-400' : 'text-red-400'}>
          {sum.toFixed(1)}% / 100%
        </span>
      </div>
      <div className="h-4 bg-gray-800 rounded-full overflow-hidden border border-gray-700 flex">
        {rows.map((row, idx) => {
          const width = (row.probability / 100) * 100;
          const colors = [
            'bg-pink-500',
            'bg-cyan-500',
            'bg-amber-500',
            'bg-emerald-500',
            'bg-purple-500',
            'bg-orange-500',
          ];
          return (
            <div
              key={row.id}
              className={`h-full ${colors[idx % colors.length]} transition-all duration-200 border-r border-gray-900 last:border-r-0`}
              style={{ width: `${Math.min(width, 100 - (rows.slice(0, idx).reduce((a, r) => a + (r.probability || 0), 0) / 100) * 100)}%` }}
              title={`伤害 ${row.minDamage}-${row.maxDamage}: ${row.probability}%`}
            />
          );
        })}
        {/* Overflow indicator */}
        {sum > 100 && (
          <div
            className="h-full bg-red-600 animate-pulse"
            style={{ width: `${Math.min((sum - 100), 20)}%` }}
            title="超出 100%"
          />
        )}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {rows.map((row, idx) => {
          const colors = [
            'bg-pink-500',
            'bg-cyan-500',
            'bg-amber-500',
            'bg-emerald-500',
            'bg-purple-500',
            'bg-orange-500',
          ];
          return (
            <div key={row.id} className="flex items-center gap-1.5 text-xs text-gray-500">
              <div className={`w-2 h-2 rounded-sm ${colors[idx % colors.length]}`} />
              <span>{row.minDamage}-{row.maxDamage}: {row.probability}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Probability Bar (per-row) ─────────────────────────────────────────────────
function ProbBar({ value }: { value: number }) {
  const pct   = Math.min(Math.max(value, 0), 100);
  const ok    = Math.abs(pct - 100) < 0.001;
  const color = ok ? 'bg-emerald-500' : pct > 100 ? 'bg-red-500' : 'bg-pink-500';
  return (
    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden border border-gray-700 mt-1">
      <div className={`h-full rounded-full transition-all duration-200 ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

// ── Item Card (TC-AC-04, TC-AC-05, TC-AC-08, TC-AC-11-16, TC-AC-30, TC-AC-31) ──
interface ItemCardProps {
  propKey:          'propA' | 'propB';
  label:            string;
  taskLabel:        string;
  dailyLabel:        string;
  color:            'pink' | 'blue';
  rows:             DamageRow[];
  taskThreshold:     number;
  dailyLimit:       number;
  error:            string | undefined;
  onRowsChange:      (rows: DamageRow[]) => void;
  onTaskThresholdChange: (v: number) => void;
  onDailyLimitChange:   (v: number) => void;
}

function ItemCard({
  label, taskLabel, dailyLabel, color,
  rows, taskThreshold, dailyLimit, error,
  onRowsChange, onTaskThresholdChange, onDailyLimitChange,
}: ItemCardProps) {
  const sum    = calcSum(rows);
  const sumOk  = Math.abs(sum - 100) < 0.001;
  const border = error ? 'border-red-500'
               : !sumOk  ? 'border-amber-500'
               : color === 'pink' ? 'border-pink-500/40'
               : 'border-blue-500/40';
  const badge  = error ? 'bg-red-500/20 text-red-400'
               : !sumOk  ? 'bg-amber-500/20 text-amber-400'
               : color === 'pink' ? 'bg-pink-500/20 text-pink-400'
               : 'bg-blue-500/20 text-blue-400';
  const rowColor = color === 'pink'
    ? { del: 'hover:bg-red-500/20 hover:text-red-400', add: 'bg-pink-500/15 border-pink-500/30 text-pink-400' }
    : { del: 'hover:bg-red-500/20 hover:text-red-400', add: 'bg-blue-500/15 border-blue-500/30 text-blue-400' };

  return (
    <div className={`border rounded-xl p-5 bg-[#161b22] transition-colors ${border}`}>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${badge}`}>
            {label}
          </span>
          <span className="text-xs text-gray-500">
            {sumOk
              ? <span className="text-emerald-400">✓ {sum.toFixed(1)}%</span>
              : <span className="text-amber-400">{sum.toFixed(1)}%</span>
            }
          </span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded border font-mono ${badge}`}>{sum.toFixed(1)}%</span>
      </div>

      {/* Cumulative Probability Distribution Bar */}
      <div className="mb-4 p-3 bg-[#0d1117] rounded-lg border border-[#21262d]">
        <SegProbBar rows={rows} />
      </div>

      {/* Task & daily limit inputs (TC-AC-08, TC-AC-30) */}
      <div className="grid grid-cols-2 gap-3 mb-4 p-3 bg-[#0d1117] rounded-lg border border-[#21262d]">
        <div>
          <label className="block text-xs text-gray-400 mb-1">{taskLabel}</label>
          <div className="relative">
            <SafeNumberInput
              value={taskThreshold}
              min={1}
              onChange={onTaskThresholdChange}
              data-field="taskThreshold"
              placeholder=""
              className="w-full px-3 py-2 bg-[#161b22] border border-[#30363d] rounded-lg text-white
                         text-sm font-mono focus:outline-none focus:border-pink-500 transition-colors"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">pt</span>
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{dailyLabel}</label>
          <div className="relative">
            <SafeNumberInput
              value={dailyLimit}
              min={1}
              onChange={onDailyLimitChange}
              placeholder=""
              className="w-full px-3 py-2 bg-[#161b22] border border-[#30363d] rounded-lg text-white
                         text-sm font-mono focus:outline-none focus:border-pink-500 transition-colors"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">次</span>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {(error || !sumOk) && (
        <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/25">
          <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">
            {error ?? `总计: ${sum.toFixed(1)}% (必须为 100%)`}
          </p>
        </div>
      )}

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_1fr_1fr_40px] gap-2 mb-2 px-1">
        {['最小伤害', '最大伤害', '概率 (%)', ''].map((h) => (
          <span key={h} className="text-xs text-gray-500 font-medium">{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div key={row.id} className="grid grid-cols-[1fr_1fr_1fr_40px] gap-2 items-center">
            <SafeNumberInput
                  value={row.minDamage}
                  min={0}
                  onChange={(v) => onRowsChange(rows.map((r, i) => i === idx ? { ...r, minDamage: v } : r))}
                  data-field={`minDamage-${idx}`}
                  placeholder="1"
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-white
                             text-sm font-mono focus:outline-none focus:border-pink-500 transition-colors"
                />
                <SafeNumberInput
                  value={row.maxDamage}
                  min={0}
                  onChange={(v) => onRowsChange(rows.map((r, i) => i === idx ? { ...r, maxDamage: v } : r))}
                  data-field={`maxDamage-${idx}`}
                  placeholder="5"
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-white
                             text-sm font-mono focus:outline-none focus:border-pink-500 transition-colors"
                />
                <div>
                  <SafeNumberInput
                    value={row.probability}
                    min={0}
                    max={100}
                    onChange={(v) => onRowsChange(rows.map((r, i) => i === idx ? { ...r, probability: v } : r))}
                    data-field={`probability-${idx}`}
                    placeholder="50"
                    className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-white
                               text-sm font-mono focus:outline-none focus:border-pink-500 transition-colors"
                  />
              <ProbBar value={row.probability} />
            </div>
            <button
              type="button"
              onClick={() => onRowsChange(rows.filter((_, i) => i !== idx))}
              className={`w-8 h-8 flex items-center justify-center rounded-lg border border-transparent
                          text-gray-500 transition-all ${rowColor.del}`}
              title="删除此行"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Add row */}
      <button
        type="button"
        onClick={() => onRowsChange([...rows, { id: newRowId(), minDamage: 0, maxDamage: 0, probability: 0 }])}
        className={`mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-lg border text-sm
                    font-medium transition-colors cursor-pointer ${rowColor.add}`}
      >
        <Plus size={14} />
        添加伤害值
      </button>
    </div>
  );
}

// ── Milestone Card (TC-AC-09, TC-AC-10, TC-AC-28, TC-AC-29) ──────────────────
interface MilestoneCardProps {
  milestone:      Milestone;
  errors:        Record<string, string>;
  onChange:      (m: Milestone) => void;
  onRemove:      () => void;
}

function MilestoneCard({ milestone, errors, onChange, onRemove }: MilestoneCardProps) {
  const thresholdErr = errors[milestone.id];
  const isMedal     = milestone.rewardType === 'MEDAL';
  const hasMedalId  = isMedal && !!milestone.medalId;

  // ── TC-AC-10 / TC-AC-29: Debounced badge fetch ──────────────────────────────
  const [badgeInfo,   setBadgeInfo]   = useState<BadgeInfo | null>(null);
  const [badgeStatus, setBadgeStatus] = useState<'idle' | 'loading' | 'found' | 'notfound'>('idle');

  useEffect(() => {
    if (!isMedal || !hasMedalId) {
      setBadgeInfo(null);
      setBadgeStatus('idle');
      return;
    }

    setBadgeStatus('loading');

    const timer = setTimeout(async () => {
      try {
        // Phase A (2026-09-11): call BadgeAdapter.getBadgeDetail() via the
        // thin preview proxy.  NEVER queries the local public.badges table.
        const res = await adminFetch(
          `/api/admin/badge/preview?badge_id=${encodeURIComponent(milestone.medalId!)}`,
        );
        const json = await res.json();
        // 200 + ok → found.  200 + ok:false + reason=NOT_FOUND/INACTIVE → not found.
        // 502 → upstream unreachable.  Both map to the "not found" UI state.
        if (json.ok && json.data) {
          setBadgeInfo(json.data as BadgeInfo);
          setBadgeStatus('found');
        } else {
          setBadgeInfo(null);
          setBadgeStatus('notfound');
        }
      } catch {
        setBadgeInfo(null);
        setBadgeStatus('notfound');
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [isMedal, hasMedalId, milestone.medalId]);

  return (
    <div className={`border rounded-xl p-4 bg-[#161b22] transition-colors ${
      thresholdErr ? 'border-red-500' : 'border-[#30363d]'
    }`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-white">进度奖励</span>
        <button
          type="button"
          onClick={onRemove}
          className="w-7 h-7 flex items-center justify-center rounded-lg
                     text-gray-500 hover:bg-red-500/20 hover:text-red-400 transition-all"
          title="删除进度奖励"
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-[1fr_1fr_1fr] gap-3">
        {/* Threshold (TC-AC-28) */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            个人累计伤害要求 <span className="text-red-400">*</span>
          </label>
          <SafeNumberInput
            value={milestone.threshold}
            min={0}
            onChange={(v) => onChange({ ...milestone, threshold: v })}
            aria-invalid={Boolean(thresholdErr)}
            placeholder="1000"
            className={`w-full px-3 py-2 bg-[#0d1117] border rounded-lg text-white text-sm font-mono
                        focus:outline-none transition-colors ${
                          thresholdErr
                            ? 'border-red-500 focus:border-red-500'
                            : 'border-[#30363d] focus:border-pink-500'
                        }`}
          />
          {thresholdErr && (
            <p className="mt-1 text-xs text-red-400 flex items-center gap-1">
              <AlertTriangle size={10} />{thresholdErr}
            </p>
          )}
        </div>

        {/* Reward type */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">奖励类型</label>
          <select
            value={milestone.rewardType}
            onChange={(e) => onChange({ ...milestone, rewardType: e.target.value as RewardType })}
            className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-white
                       text-sm focus:outline-none focus:border-pink-500 transition-colors cursor-pointer"
          >
            <option value="ENERGY">⚡ 电量</option>
            <option value="MEDAL">🏅 勋章</option>
          </select>
        </div>

        {/* Reward value — energy OR medal (wrapped for 3-col grid) */}
        <div>
          {milestone.rewardType === 'ENERGY' ? (
          <div>
            <label className="block text-xs text-gray-400 mb-1">奖励电量</label>
            <div className="relative">
              <SafeNumberInput
                value={milestone.energyValue ?? 0}
                min={1}
                onChange={(v) => onChange({ ...milestone, energyValue: v })}
                placeholder="100"
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-white
                           text-sm font-mono focus:outline-none focus:border-pink-500 transition-colors"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">pt</span>
            </div>
          </div>
          ) : (
          <div>
            {/* Medal ID with live badge preview — TC-AC-10, TC-AC-29 */}
            <label className="block text-xs text-gray-400 mb-1">勋章 ID <span className="text-red-400">*</span></label>
            <div className="relative">
              <input
                type="text"
                value={milestone.medalId ?? ''}
                onChange={(e) => onChange({ ...milestone, medalId: e.target.value || undefined })}
                className="w-full px-3 py-2 pr-10 bg-[#0d1117] border border-[#30363d] rounded-lg text-white
                           text-sm font-mono focus:outline-none focus:border-pink-500 transition-colors"
                placeholder="1"
              />
              {badgeStatus === 'loading' && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
              )}
            </div>

            {/* TC-AC-10: Badge preview — found (Phase A: from Main Station) */}
            {badgeStatus === 'found' && badgeInfo && (
              <div className="mt-2 flex items-start gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
                {badgeInfo.thumbnail ? (
                  <img
                    src={badgeInfo.thumbnail}
                    alt={badgeInfo.name}
                    className="w-8 h-8 rounded-lg object-cover border border-emerald-500/30 shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 shrink-0 flex items-center justify-center text-xs">🏅</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-emerald-400 truncate">{badgeInfo.name}</p>
                  {badgeInfo.description && (
                    <p className="text-[10px] text-emerald-500/60 leading-snug mt-0.5 line-clamp-2">{badgeInfo.description}</p>
                  )}
                  <p className="text-[10px] text-emerald-500/50 font-mono mt-0.5">ID {badgeInfo.badge_id}</p>
                </div>
              </div>
            )}

            {/* TC-AC-29: Badge preview — not found */}
            {badgeStatus === 'notfound' && (
              <div className="mt-2 flex items-center gap-1.5 p-2 rounded-lg bg-red-500/10 border border-red-500/25">
                <XCircle size={12} className="text-red-400 shrink-0" />
                <p className="text-xs text-red-400">勋章不存在或 Main Station 无法访问</p>
              </div>
            )}

            {/* Soft hint when MEDAL selected but no ID yet */}
            {isMedal && !hasMedalId && (
              <p className="mt-1 text-xs text-gray-600">输入勋章 ID 后自动从 Main Station 验证</p>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── HP Preview Bar ───────────────────────────────────────────────────────────────
// P0 2026-07-30: Upgraded HP preview bar with:
//   - Percentage slider (0–100%) for real-time precise HP control
//   - Threshold markers at 75% / 50% / 25% with active-stage highlight
//   - Emits onSliderChange so the parent form state stays in sync
function HPPreviewBar({
  currentHp,
  totalHp,
  onSliderChange,
}: {
  currentHp: number;
  totalHp: number;
  onSliderChange?: (hp: number) => void;
}) {
  const pct = totalHp > 0 ? Math.min(Math.max((currentHp / totalHp) * 100, 0), 100) : 0;
  const pctInt = Math.round(pct);

  const color =
    pctInt > 75 ? 'bg-emerald-500' :
    pctInt > 50 ? 'bg-lime-500' :
    pctInt > 25 ? 'bg-amber-500' :
    pctInt > 0  ? 'bg-red-500' :
    'bg-gray-600';

  const activePhase =
    pctInt > 75 ? '75%+' :
    pctInt > 50 ? '50%–75%' :
    pctInt > 25 ? '25%–50%' :
    pctInt > 0  ? '25%以下' :
    '已击败';

  const THRESHOLDS = [
    { label: '75%', pct: 75, pos: 75 },
    { label: '50%', pct: 50, pos: 50 },
    { label: '25%', pct: 25, pos: 25 },
  ];

  return (
    <div className="mt-3 space-y-3">
      {/* Header row: label + live percentage + phase */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">血量预览</span>
        <div className="flex items-center gap-3">
          <span className="text-[10px] px-2 py-0.5 rounded-full border" style={{
            color: pctInt > 75 ? '#86efac' : pctInt > 50 ? '#bef264' : pctInt > 25 ? '#fcd34d' : '#fca5a5',
            borderColor: pctInt > 75 ? '#86efac40' : pctInt > 50 ? '#bef26440' : pctInt > 25 ? '#fcd34d40' : '#fca5a540',
            background: pctInt > 75 ? '#86efac10' : pctInt > 50 ? '#bef26410' : pctInt > 25 ? '#fcd34d10' : '#fca5a510',
          }}>
            {activePhase}
          </span>
          <span className="font-mono text-xs text-gray-300">
            {currentHp.toLocaleString()} / {totalHp.toLocaleString()}
          </span>
          <span className="font-mono text-sm font-semibold" style={{ color: pctInt > 50 ? '#86efac' : pctInt > 25 ? '#fcd34d' : '#fca5a5' }}>
            {pct.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Bar with threshold markers */}
      <div className="relative">
        {/* Threshold tick marks */}
        <div className="absolute inset-0 h-full pointer-events-none" style={{ zIndex: 2 }}>
          {THRESHOLDS.map(({ label, pos }) => (
            <div
              key={label}
              className="absolute top-0 h-full flex flex-col items-center"
              style={{ left: `${pos}%`, transform: 'translateX(-50%)' }}
            >
              <span
                className="text-[9px] font-mono mt-0.5"
                style={{ color: pctInt >= pos ? '#fcd34d' : '#4b5563' }}
              >
                {label}
              </span>
              <div
                className="w-px h-3 mt-0.5"
                style={{ background: pctInt >= pos ? '#fcd34d60' : '#374151' }}
              />
            </div>
          ))}
        </div>

        {/* Background + bar */}
        <div className="h-4 bg-gray-800 rounded-full overflow-hidden border border-gray-700" style={{ position: 'relative', zIndex: 1 }}>
          <div
            className={`h-full rounded-full transition-all duration-200 ${color}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Percentage slider */}
      <div className="space-y-1.5">
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={pctInt}
          onChange={(e) => {
            const newPct = Number(e.target.value);
            const newHp = Math.round((newPct / 100) * totalHp);
            onSliderChange?.(newHp);
          }}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, ${pctInt > 50 ? '#22c55e' : pctInt > 25 ? '#f59e0b' : '#ef4444'} ${pctInt}%, #374151 ${pctInt}%)`,
          }}
        />
        {/* Slider tick labels */}
        <div className="flex justify-between text-[9px] text-gray-600 font-mono px-0.5">
          <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
        </div>
      </div>
    </div>
  );
}

// ── Section: Basic Info ──────────────────────────────────────────────────────
function BasicInfoSection({
  form, errors, onField,
}: {
  form:    FormData;
  errors:  ValidationErrors;
  onField: (k: keyof FormData, v: string | boolean | number) => void;
}) {
  return (
    <section className="space-y-6">
      <h2 className="text-base font-semibold text-white flex items-center gap-2">
        <Activity size={16} className="text-pink-400" />
        基本信息
      </h2>

      {/* Global Switch */}
      <div className="flex items-center justify-between p-4 bg-[#161b22] border border-[#30363d] rounded-xl">
        <div>
          <div className="text-sm font-medium text-white">活动总开关</div>
          <div className="text-xs text-gray-500 mt-0.5">关闭后玩家无法参与此活动</div>
        </div>
        <button
          type="button"
          onClick={() => onField('isGlobalEnabled', !form.isGlobalEnabled)}
          className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
            form.isGlobalEnabled ? 'bg-emerald-500' : 'bg-gray-600'
          }`}
          role="switch"
          aria-checked={form.isGlobalEnabled}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${form.isGlobalEnabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {/* REPARK 7.0 Batch C (2026-08-28): 每日自动重置 toggle. */}
      <div className="flex items-center justify-between p-4 bg-[#161b22] border border-[#30363d] rounded-xl">
        <div>
          <div className="text-sm font-medium text-white">每日自动重置</div>
          <div className="text-xs text-gray-500 mt-0.5">关闭后每日任务进度按活动周期累计，不再每日清零</div>
        </div>
        <button
          type="button"
          onClick={() => onField('dailyResetEnabled', !form.dailyResetEnabled)}
          className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
            form.dailyResetEnabled ? 'bg-emerald-500' : 'bg-gray-600'
          }`}
          role="switch"
          aria-checked={form.dailyResetEnabled}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${form.dailyResetEnabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {/* Activity Name */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          活动名称 <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          maxLength={50}
          onChange={(e) => onField('name', e.target.value.slice(0, 50))}
          placeholder="例如：夏日狂欢节 BOSS 战"
          data-field="name"
          aria-invalid={Boolean(errors.name)}
          className={`w-full px-4 py-2.5 bg-[#0d1117] border rounded-xl text-white placeholder-gray-500
                      focus:outline-none transition-colors text-sm ${
                        errors.name
                          ? 'border-red-500 focus:border-red-500'
                          : 'border-[#30363d] focus:border-pink-500'
                      }`}
        />
        {errors.name && (
          <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
            <AlertTriangle size={12} />{errors.name}
          </p>
        )}
        <p className="mt-1 text-xs text-gray-600">{form.name.length} / 50</p>
      </div>

      {/* Time Settings */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            开始时间 <span className="text-red-400">*</span>
            <span className="text-gray-600 font-normal ml-1">(UTC+8 北京时间)</span>
          </label>
          <input
            type="datetime-local"
            value={form.start_time}
            onChange={(e) => onField('start_time', e.target.value)}
            data-field="start_time"
            aria-invalid={Boolean(errors.start_time)}
            className={`w-full px-3 py-2.5 bg-[#0d1117] border rounded-xl text-white
                        focus:outline-none transition-colors text-sm ${
                          errors.start_time
                            ? 'border-red-500 focus:border-red-500'
                            : 'border-[#30363d] focus:border-pink-500'
                        }`}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            结束时间 <span className="text-red-400">*</span>
            <span className="text-gray-600 font-normal ml-1">(UTC+8 北京时间)</span>
          </label>
          <input
            type="datetime-local"
            value={form.end_time}
            onChange={(e) => onField('end_time', e.target.value)}
            data-field="end_time"
            aria-invalid={Boolean(errors.end_time)}
            className={`w-full px-3 py-2.5 bg-[#0d1117] border rounded-xl text-white
                        focus:outline-none focus:border-pink-500 transition-colors text-sm
                        ${errors.end_time ? 'border-red-500' : 'border-[#30363d]'}`}
          />
        </div>
      </div>

      {errors.start_time && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/25 rounded-xl">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{errors.start_time}</p>
        </div>
      )}

      {/* Rules */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">活动规则</label>
        <textarea
          value={form.rules}
          onChange={(e) => onField('rules', e.target.value)}
          placeholder="在此输入活动规则说明，支持多行文本..."
          rows={5}
          className="w-full px-4 py-3 bg-[#0d1117] border border-[#30363d] rounded-xl text-white
                     placeholder-gray-600 focus:outline-none focus:border-pink-500 transition-colors
                     text-sm resize-none leading-relaxed"
        />
      </div>
    </section>
  );
}

// ── Section: Boss HP ───────────────────────────────────────────────────────────
function BossHPSection({
  form, errors, onField,
}: {
  form:    FormData;
  errors:  ValidationErrors;
  onField: (k: keyof FormData, v: string | boolean | number) => void;
}) {
  const totalHpNum   = Number(form.totalHp);
  const currentHpNum = Number(form.currentHp);

  return (
    <section className="space-y-6">
      <h2 className="text-base font-semibold text-white flex items-center gap-2">
        <Zap size={16} className="text-amber-400" />
        Boss 血量管理
      </h2>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            总血量 <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <SafeNumberInput
              value={form.totalHp}
              min={1}
              onChange={(v) => onField('totalHp', v)}
              data-field="totalHp"
              aria-invalid={Boolean(errors.totalHp)}
              placeholder="100000"
              className={`w-full px-4 py-2.5 bg-[#0d1117] border rounded-xl text-white font-mono text-sm
                          focus:outline-none transition-colors ${
                            errors.totalHp ? 'border-red-500 focus:border-red-500' : 'border-[#30363d] focus:border-pink-500'
                          }`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">HP</span>
          </div>
          {errors.totalHp && (
            <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
              <AlertTriangle size={12} />{errors.totalHp}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            当前血量 <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <SafeNumberInput
              value={form.currentHp}
              min={0}
              onChange={(v) => onField('currentHp', v)}
              data-field="currentHp"
              aria-invalid={Boolean(errors.currentHp)}
              placeholder="100000"
              className={`w-full px-4 py-2.5 bg-[#0d1117] border rounded-xl text-white font-mono text-sm
                          focus:outline-none transition-colors ${
                            errors.currentHp ? 'border-red-500 focus:border-red-500' : 'border-[#30363d] focus:border-pink-500'
                          }`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">HP</span>
          </div>
          {errors.currentHp && (
            <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
              <AlertTriangle size={12} />{errors.currentHp}
            </p>
          )}
        </div>
      </div>

      {!errors.totalHp && !errors.currentHp && (
        <HPPreviewBar
          currentHp={currentHpNum}
          totalHp={totalHpNum}
          onSliderChange={(hp) => onField('currentHp', hp)}
        />
      )}
    </section>
  );
}

// ── Section: Item Config ───────────────────────────────────────────────────────
function ItemConfigSection({
  form, errors,
  onPropRows, onPropTaskThreshold, onPropDailyLimit, onPropNameChange,
}: {
  form:                 FormData;
  errors:               ValidationErrors;
  onPropRows:            (key: 'propA' | 'propB', rows: DamageRow[]) => void;
  onPropTaskThreshold:    (key: 'propA' | 'propB', v: number) => void;
  onPropDailyLimit:      (key: 'propA' | 'propB', v: number) => void;
  // REPARK 7.0 (2026-08-28) Batch B: editable item display name (propA.name / propB.name).
  onPropNameChange:      (key: 'propA' | 'propB', name: string) => void;
}) {
  const propASum = calcSum(form.propA.rows);
  const propBSum = calcSum(form.propB.rows);
  const propAOk  = Math.abs(propASum - 100) < 0.001;
  const propBOk  = Math.abs(propBSum - 100) < 0.001;

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <Package size={16} className="text-blue-400" />
          道具配置
        </h2>
        {(!propAOk || !propBOk) && (
          <span className="px-2 py-0.5 rounded border text-xs font-semibold bg-amber-500/20 text-amber-400 border-amber-500/30">
            ⚠ 需修正
          </span>
        )}
      </div>

      <p className="text-xs text-gray-500 -mt-2">
        每个道具的掉落概率总和必须等于 100%。否则无法保存配置。
      </p>

      {/* Prop A */}
      <div data-field="propA">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <span className="text-base shrink-0">⚡</span>
          <input
            type="text"
            value={form.propA.name}
            onChange={(e) => onPropNameChange('propA', e.target.value)}
            placeholder="道具 A 名称"
            maxLength={20}
            data-field="propA-name"
            aria-label="道具 A 显示名称"
            className="px-2.5 py-1 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm font-semibold text-pink-400
                       focus:outline-none focus:border-pink-500 transition-colors min-w-[140px]"
          />
          <span className="text-xs text-gray-500">(Prop A · 消耗任务)</span>
        </div>
        <ItemCard
          propKey="propA"
          label={form.propA.name || '闪电符文'}
          taskLabel="单次消耗电量 (pt)"
          dailyLabel="每日获取上限 (次)"
          color="pink"
          rows={form.propA.rows}
          taskThreshold={form.propA.taskThreshold}
          dailyLimit={form.propA.dailyLimit}
          error={errors.propA}
          onRowsChange={(rows) => onPropRows('propA', rows)}
          onTaskThresholdChange={(v) => onPropTaskThreshold('propA', v)}
          onDailyLimitChange={(v) => onPropDailyLimit('propA', v)}
        />
      </div>

      {/* Prop B */}
      <div data-field="propB">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <span className="text-base shrink-0">💎</span>
          <input
            type="text"
            value={form.propB.name}
            onChange={(e) => onPropNameChange('propB', e.target.value)}
            placeholder="道具 B 名称"
            maxLength={20}
            data-field="propB-name"
            aria-label="道具 B 显示名称"
            className="px-2.5 py-1 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm font-semibold text-blue-400
                       focus:outline-none focus:border-blue-500 transition-colors min-w-[140px]"
          />
          <span className="text-xs text-gray-500">(Prop B · 充值任务)</span>
        </div>
        <ItemCard
          propKey="propB"
          label={form.propB.name || '潮汐晶石'}
          taskLabel="单次充值金额 (元)"
          dailyLabel="每日获取上限 (次)"
          color="blue"
          rows={form.propB.rows}
          taskThreshold={form.propB.taskThreshold}
          dailyLimit={form.propB.dailyLimit}
          error={errors.propB}
          onRowsChange={(rows) => onPropRows('propB', rows)}
          onTaskThresholdChange={(v) => onPropTaskThreshold('propB', v)}
          onDailyLimitChange={(v) => onPropDailyLimit('propB', v)}
        />
      </div>
    </section>
  );
}

// ── Section: Milestones ────────────────────────────────────────────────────────
function MilestonesSection({
  form, errors,
  onMilestonesChange,
}: {
  form:             FormData;
  errors:           ValidationErrors;
  onMilestonesChange: (ms: Milestone[]) => void;
}) {
  const msErrors = errors.milestones ?? {};

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <Flag size={16} className="text-amber-400" />
          进度奖励
        </h2>
        {Object.keys(msErrors).length > 0 && (
          <span className="px-2 py-0.5 rounded border text-xs font-semibold bg-red-500/20 text-red-400 border-red-500/30">
            ⚠ 有错误
          </span>
        )}
      </div>

      <p className="text-xs text-gray-500 -mt-2">
        每个进度奖励设置玩家个人累计伤害达到阈值时即可领取。奖励类型支持「电量」或「勋章」。
      </p>

      {form.milestones.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-[#30363d] rounded-xl bg-[#161b22]">
          <Flag size={24} className="text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500">暂无进度奖励配置</p>
        </div>
      ) : (
        <div className="space-y-3">
          {form.milestones.map((ms) => (
            <MilestoneCard
              key={ms.id}
              milestone={ms}
              errors={msErrors}
              onChange={(updated) =>
                onMilestonesChange(
                  form.milestones.map((m) => (m.id === updated.id ? updated : m)),
                )
              }
              onRemove={() =>
                onMilestonesChange(form.milestones.filter((m) => m.id !== ms.id))
              }
            />
          ))}
        </div>
      )}

      {/* Add milestone */}
      <button
        type="button"
        onClick={() => {
          const newId = generateUniqueMilestoneId(form.milestones || []);
          onMilestonesChange([
            ...(form.milestones || []),
            {
              id: newId,
              threshold: 0,
              rewardType: 'ENERGY',
              energyValue: 100,
            },
          ]);
        }}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed
                   border-[#30363d] text-sm text-gray-500 hover:border-pink-500/50 hover:text-pink-400
                   hover:bg-pink-500/5 transition-all cursor-pointer"
      >
        <Plus size={16} />
        添加进度奖励节点
      </button>
    </section>
  );
}

// ── Spine Section — threshold only (forms/morphs removed per REPARK 2026-08-21) ──

function SpineSection({
  form,
  errors,
  onSpineChange,
}: {
  form: { spine: SpineConfig };
  errors: ValidationErrors;
  onSpineChange: (s: SpineConfig) => void;
}) {
  const { stage2 = 75, stage3 = 50, stage4 = 25 } =
    form.spine?.formThresholds ?? {};

  const isValid = (s2: number, s3: number, s4: number) =>
    s2 > s3 && s3 > s4 && s2 > 0 && s3 > 0 && s4 > 0 && s2 <= 100 && s3 <= 100 && s4 <= 100;

  const valid = isValid(stage2, stage3, stage4);

  const updateThreshold = (key: keyof SpineFormThresholds, val: number) =>
    onSpineChange({ formThresholds: { ...(form.spine?.formThresholds ?? { stage2: 75, stage3: 50, stage4: 25 }), [key]: val } });

  return (
    <div data-field="spine" className="space-y-4">
      <label className="block text-sm font-medium text-gray-300">
        形态解锁血量节点（兼容性配置）
      </label>
      <div className="grid grid-cols-3 gap-3">
        {([
          { key: 'stage2' as const, label: '阶段 2 解锁血量 (%)', val: stage2 },
          { key: 'stage3' as const, label: '阶段 3 解锁血量 (%)', val: stage3 },
          { key: 'stage4' as const, label: '阶段 4 解锁血量 (%)', val: stage4 },
        ] as const).map(({ key, label, val }) => (
          <div key={key}>
            <label className="block text-xs text-gray-500 mb-1">{label}</label>
            <div className="relative">
              <SafeNumberInput
                value={val}
                min={1}
                max={100}
                onChange={(v) => updateThreshold(key, v)}
                placeholder="75"
                className="w-full px-3 py-2.5 bg-[#0d1117] border border-[#30363d] rounded-xl text-white
                           text-sm font-mono focus:outline-none focus:border-cyan-500 transition-colors"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">%</span>
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 rounded-lg bg-[#0d1117] border border-[#21262d]">
        <p className="text-xs text-gray-500">
          当前阶段顺序：<span className="text-white font-mono">{stage2}%</span>
          {' > '}
          <span className="text-white font-mono">{stage3}%</span>
          {' > '}
          <span className="text-white font-mono">{stage4}%</span>
          {' > 0%'}
        </p>
        {!valid && (
          <p className="mt-1 text-xs text-amber-400 flex items-center gap-1">
            <AlertTriangle size={11} />
            必须满足：100% &gt; 阶段2 &gt; 阶段3 &gt; 阶段4 &gt; 0%
          </p>
        )}
        {valid && (
          <p className="mt-1 text-xs text-emerald-400 flex items-center gap-1">
            <CheckCircle size={11} />
            阈值顺序正确
          </p>
        )}
      </div>

      {errors.spine && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/25">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{errors.spine}</p>
        </div>
      )}
    </div>
  );
}

// ── Character Profile Section (REPARK 6.0 2026-08-14) ─────────────────────────
// Admin form authoring the H5 `CharacterIntroPanel` contents: 4 stage names,
// dynamic Bio rows, and dynamic Skill rows. Empty fields are tolerated — the
// H5 client falls back to DEFAULT_BIO / DEFAULT_SKILLS / DEFAULT_STAGE_NAMES.
function CharacterProfileSection({
  profile, onChange,
}: {
  profile: FormData['characterProfile'];
  onChange: (next: FormData['characterProfile']) => void;
}) {
  const updateField = <K extends keyof FormData['characterProfile']>(
    key: K, value: FormData['characterProfile'][K],
  ) => onChange({ ...profile, [key]: value });

  const updateStageName = (idx: number, value: string) => {
    const next = [...profile.stageNames];
    while (next.length <= 4) next.push('');
    next[idx] = value;
    updateField('stageNames', next);
  };

  const addBio = () =>
    onChange({
      ...profile,
      bio: [...profile.bio, { label: '', value: '' }],
    });

  const updateBio = (idx: number, patch: Partial<CharacterBioItem>) =>
    onChange({
      ...profile,
      bio: profile.bio.map((row, i) => i === idx ? { ...row, ...patch } : row),
    });

  const removeBio = (idx: number) =>
    onChange({
      ...profile,
      bio: profile.bio.filter((_, i) => i !== idx),
    });

  const addSkill = () =>
    onChange({
      ...profile,
      skills: [...profile.skills, { name: '', desc: '' }],
    });

  const updateSkill = (idx: number, patch: Partial<CharacterSkillItem>) =>
    onChange({
      ...profile,
      skills: profile.skills.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    });

  const removeSkill = (idx: number) =>
    onChange({
      ...profile,
      skills: profile.skills.filter((_, i) => i !== idx),
    });

  return (
    <section className="space-y-6">
      <h2 className="text-base font-semibold text-white flex items-center gap-2">
        <User size={16} className="text-cyan-400" />
        角色档案配置（H5 侧边栏「角色档案」面板内容）
      </h2>

      <p className="text-xs text-gray-500 -mt-2">
        配置战斗页面左侧「角色档案」折叠面板显示的内容。留空字段在前端展示时会回退到默认值，不会留白。
      </p>

      {/* Character Name */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          角色基础名（可选）
        </label>
        <input
          type="text"
          value={profile.characterName}
          onChange={(e) => updateField('characterName', e.target.value)}
          placeholder="例如：深渊魅魔"
          className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-white text-sm
                     focus:outline-none focus:border-cyan-500 transition-colors"
        />
      </div>

      {/* Stage Names (4 stages, fixed) */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          4 阶段形态名称
        </label>
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((idx) => (
            <div key={idx}>
              <label className="block text-[11px] text-gray-500 mb-1">
                阶段 {idx + 1}
              </label>
              <input
                type="text"
                value={profile.stageNames[idx] ?? ''}
                onChange={(e) => updateStageName(idx, e.target.value)}
                placeholder={DEFAULT_STAGE_NAMES[idx] ?? `阶段 ${idx + 1}`}
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-white text-sm
                           focus:outline-none focus:border-cyan-500 transition-colors"
                maxLength={20}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Bio rows */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-300">
            角色属性（Bio）
          </label>
          <span className="text-xs text-gray-500">{profile.bio.length} 行</span>
        </div>

        <div className="grid grid-cols-[1fr_1fr_40px] gap-2 mb-2 px-1">
          {['属性标签（如「种族」）', '属性值（如「深渊魅魔」）', ''].map((h) => (
            <span key={h} className="text-xs text-gray-500 font-medium">{h}</span>
          ))}
        </div>

        <div className="space-y-2">
          {profile.bio.map((row, idx) => (
            <div key={`bio-${idx}`} className="grid grid-cols-[1fr_1fr_40px] gap-2 items-center">
              <input
                type="text"
                value={row.label}
                onChange={(e) => updateBio(idx, { label: e.target.value })}
                placeholder="种族"
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-white text-sm
                           focus:outline-none focus:border-cyan-500 transition-colors"
                maxLength={20}
              />
              <input
                type="text"
                value={row.value}
                onChange={(e) => updateBio(idx, { value: e.target.value })}
                placeholder="深渊魅魔"
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-white text-sm
                           focus:outline-none focus:border-cyan-500 transition-colors"
                maxLength={40}
              />
              <button
                type="button"
                onClick={() => removeBio(idx)}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-transparent
                           text-gray-500 hover:bg-red-500/20 hover:text-red-400 transition-all"
                title="删除此行"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addBio}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium
                     bg-cyan-500/15 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/25 transition-colors cursor-pointer"
        >
          <Plus size={14} />
          添加属性
        </button>
      </div>

      {/* Skill rows */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-300">
            技能列表（Skills）
          </label>
          <span className="text-xs text-gray-500">{profile.skills.length} 项</span>
        </div>

        <div className="grid grid-cols-[1fr_2fr_40px] gap-2 mb-2 px-1">
          {['技能名称', '技能描述', ''].map((h) => (
            <span key={h} className="text-xs text-gray-500 font-medium">{h}</span>
          ))}
        </div>

        <div className="space-y-2">
          {profile.skills.map((skill, idx) => (
            <div key={`skill-${idx}`} className="grid grid-cols-[1fr_2fr_40px] gap-2 items-center">
              <input
                type="text"
                value={skill.name}
                onChange={(e) => updateSkill(idx, { name: e.target.value })}
                placeholder="灵魂汲取"
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-white text-sm
                           focus:outline-none focus:border-cyan-500 transition-colors"
                maxLength={30}
              />
              <input
                type="text"
                value={skill.desc}
                onChange={(e) => updateSkill(idx, { desc: e.target.value })}
                placeholder="每次攻击偷取目标生命力"
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-white text-sm
                           focus:outline-none focus:border-cyan-500 transition-colors"
                maxLength={80}
              />
              <button
                type="button"
                onClick={() => removeSkill(idx)}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-transparent
                           text-gray-500 hover:bg-red-500/20 hover:text-red-400 transition-all"
                title="删除此技能"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addSkill}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium
                     bg-cyan-500/15 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/25 transition-colors cursor-pointer"
        >
          <Plus size={14} />
          添加技能
        </button>
      </div>
    </section>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────────

// REPARK 6.0 (2026-08-23): When a number input shows "0" or empty, focus
// should pre-select the contents so a single Backspace clears the field
// instead of leaving a stubborn "0" that the operator has to overwrite.
// Empty branch matters for energyValue which renders '' when undefined.
const selectIfZero = (e: React.FocusEvent<HTMLInputElement>) => {
  if (e.target.value === '0' || e.target.value === '') {
    e.target.select();
  }
};

// REPARK 6.0 (2026-08-23) P2 root fix for stuck-at-zero number inputs.
// Native `<input type="number">` round-trips an empty string to `0` on
// every backspace, trapping the caret before a sticky "0". This component
// keeps a local text buffer so the input is genuinely empty (text === ''),
// then propagates a parsed 0 upwards. selectOnFocus uses setTimeout to dodge
// the React Chrome-mouseup edge case where a programmatic select() is
// silently cancelled by the OS's own selection event.
interface SafeNumberInputProps {
  value: number | null | undefined;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  className?: string;
  'data-field'?: string;
  'aria-invalid'?: boolean | 'false' | 'true';
  disabled?: boolean;
}
function SafeNumberInput({
  value,
  onChange,
  min,
  max,
  placeholder,
  className,
  'data-field': dataField,
  'aria-invalid': ariaInvalid,
  disabled,
}: SafeNumberInputProps) {
  const [text, setText] = useState<string>(() =>
    value === 0 || value === undefined || value === null ? '0' : String(value),
  );

  // Sync local buffer when external value changes (e.g. reset, fetch).
  useEffect(() => {
    setText(value === undefined || value === null ? '0' : String(value));
  }, [value]);

  const clamp = (n: number) => {
    let clamped = n;
    if (typeof min === 'number' && clamped < min) clamped = min;
    if (typeof max === 'number' && clamped > max) clamped = max;
    return clamped;
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      data-field={dataField}
      aria-invalid={ariaInvalid}
      disabled={disabled}
      value={text}
      placeholder={placeholder}
      onFocus={(e) => {
        const target = e.target;
        setTimeout(() => target.select(), 10);
      }}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d]/g, '');
        setText(raw);
        const parsed = raw === '' ? 0 : clamp(Number(raw));
        onChange(parsed);
      }}
      onBlur={() => {
        // Coerce display back to the canonical 0 state when the buffer is empty.
        if (text === '') setText('0');
      }}
      className={className}
    />
  );
}

export default function ActivityConfigPage() {
  const params = useParams<{ id: string }>();
  const activityId = Number(params?.id);

  // ── State ──────────────────────────────────────────────────────────────────
  const [activity, setActivity]    = useState<Activity | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving,  setIsSaving]  = useState(false);
  const [fetchErr,  setFetchErr]  = useState<string | null>(null);
  const [toast,     setToast]     = useState<ToastMsg | null>(null);
  const [activeSection, setActiveSection] = useState('section-basic');

  const [form, setForm] = useState<FormData>({
    name: '', start_time: '', end_time: '',
    isGlobalEnabled: false, rules: '',
    totalHp: 100000, currentHp: 100000,
    propA: defaultTier('闪电符文'),
    propB: defaultTier('潮汐晶石'),
    milestones: [],
    spine: defaultSpine(),
    characterProfile: defaultCharacterProfile(),
    dailyResetEnabled: true, // REPARK 7.0 Batch C: legacy default ON
  });
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [banners, setBanners] = useState<BannerItem[]>([]);

  const showToast = useCallback((t: ToastMsg) => {
    setToast(t);
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Load ───────────────────────────────────────────────────────────────────
  const fetchActivity = useCallback(async () => {
    setIsLoading(true);
    setFetchErr(null);
    try {
      const res  = await adminFetch('/api/admin/activity');
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message ?? '加载失败');

      const found: Activity | undefined = (data.data as Activity[]).find(
        (a: Activity) => a.id === activityId,
      );
      if (!found) throw new Error(`未找到 ID=${activityId} 的活动`);

      const loadedSpine = found.config?.spine;
      const safeSpine: SpineConfig = {
        formThresholds: {
          stage2: loadedSpine?.formThresholds?.stage2 ?? 75,
          stage3: loadedSpine?.formThresholds?.stage3 ?? 50,
          stage4: loadedSpine?.formThresholds?.stage4 ?? 25,
        },
      };

      // REPARK 6.0 (2026-08-14): Hydrate the character profile sub-form from
      // the saved `character_profile` block. Missing fields fall back to the
      // canonical defaults so the UI starts with day-one values when the
      // admin hasn't authored anything yet.
      const cp = found.config?.character_profile;
      const cpDef = defaultCharacterProfile();
      const cpStageNames = cp?.stageNames;
      const hydratedProfile: FormData['characterProfile'] = {
        characterName: cp?.characterName && cp.characterName.length > 0 ? cp.characterName : cpDef.characterName,
        stageNames: Array.isArray(cpStageNames) && cpStageNames.length > 0
          ? [0, 1, 2, 3].map((i) => {
              const v = cpStageNames[i];
              return typeof v === 'string' && v.length > 0 ? v : cpDef.stageNames[i];
            })
          : [...cpDef.stageNames],
        bio: Array.isArray(cp?.bio) && cp.bio.length > 0
          ? cp.bio
              .filter((b) => b && (typeof b.label === 'string' || typeof b.value === 'string'))
              .map((b) => ({ label: String(b.label ?? ''), value: String(b.value ?? '') }))
          : cpDef.bio.map((b) => ({ ...b })),
        skills: Array.isArray(cp?.skills) && cp.skills.length > 0
          ? cp.skills
              .filter((s) => s && (typeof s.name === 'string' || typeof s.desc === 'string'))
              .map((s) => ({ name: String(s.name ?? ''), desc: String(s.desc ?? '') }))
          : cpDef.skills.map((s) => ({ ...s })),
      };

      setActivity(found);
      setForm({
        name:            found.name,
        start_time:       found.start_time?.slice(0, 16) ?? '',
        end_time:         found.end_time?.slice(0, 16) ?? '',
        isGlobalEnabled:  found.config?.isGlobalEnabled ?? false,
        rules:            found.config?.rules ?? '',
        totalHp:         found.config?.boss?.totalHp ?? 100000,
        currentHp:       found.config?.boss?.currentHp ?? 100000,
        propA: found.config?.items?.propA ?? defaultTier('闪电符文'),
        propB: found.config?.items?.propB ?? defaultTier('潮汐晶石'),
        milestones:       found.config?.milestones ?? [],
        spine:           safeSpine,
        characterProfile: hydratedProfile,
        // REPARK 7.0 Batch C (2026-08-28): hydrate the 每日自动重置 toggle
        // from the saved config. Missing field → ON (preserves the legacy
        // default and the existing production behaviour).
        dailyResetEnabled: (() => {
          const dr = found.config?.dailyReset;
          if (dr === undefined || dr === null) return true;
          return Boolean((dr as { enabled?: unknown }).enabled);
        })(),
      });

      try {
        const bannerRes = await adminFetch('/api/admin/banners');
        const bannerData = await bannerRes.json();
        if (bannerData.ok) {
          setBanners(
            (bannerData.items ?? []).filter(
              (b: BannerItem) => String(b.targetActivityId) === String(activityId),
            ),
          );
        }
      } catch {
        // Non-critical — ignore banner load errors
      }
    } catch (err) {
      setFetchErr(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [activityId]);

  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  // ── ScrollSpy ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading) {
      const observers: IntersectionObserver[] = [];
      const visible: Record<string, boolean> = {};
      SCROLLSPY_SECTIONS.forEach((id) => { visible[id] = false; });

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            visible[entry.target.id] = entry.isIntersecting;
          });
          const first = SCROLLSPY_SECTIONS.find((id) => visible[id]);
          if (first) setActiveSection(first);
        },
        { rootMargin: '-20% 0px -60% 0px', threshold: 0 },
      );

      SCROLLSPY_SECTIONS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
      });
      observers.push(observer);
      return () => observers.forEach((o) => o.disconnect());
    }
  }, [isLoading]);

  // ── Field handlers ──────────────────────────────────────────────────────────
  const onField = (key: keyof FormData, value: string | boolean | number) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete (next as Record<string, unknown>)[key];
      return next;
    });
  };

  const onPropRows       = (key: 'propA' | 'propB', rows: DamageRow[]) =>
    setForm((p) => ({ ...p, [key]: { ...p[key], rows } }));

  const onPropTaskThreshold = (key: 'propA' | 'propB', v: number) =>
    setForm((p) => ({ ...p, [key]: { ...p[key], taskThreshold: v } }));

  const onPropDailyLimit = (key: 'propA' | 'propB', v: number) =>
    setForm((p) => ({ ...p, [key]: { ...p[key], dailyLimit: v } }));

  // REPARK 7.0 (2026-08-28) Batch B: editable display name for each item tier.
  // The configured name propagates to H5 (SubPageModal fallback rules + toast +
  // task reward labels). When the operator clears the field, the legacy
  // default is restored on the next render via `form.propA.name || '闪电符文'`
  // at the consumer site — no invented default is saved to DB.
  const onPropNameChange = (key: 'propA' | 'propB', name: string) =>
    setForm((p) => ({ ...p, [key]: { ...p[key], name: name.slice(0, 20) } }));

  const onMilestonesChange = (ms: Milestone[]) =>
    setForm((p) => ({ ...p, milestones: ms }));

  const onSpineChange = (spine: SpineConfig) =>
    setForm((p) => ({ ...p, spine }));

  // ── Validation ──────────────────────────────────────────────────────────────
  //
  // REPARK 6.0 (2026-07-29): validate() no longer relies on setErrors-then-
  // read-stale-closure. It now returns BOTH the validity flag AND the freshly
  // computed errors object so the caller can show precise error messages
  // immediately, without waiting for React's async setState round-trip.
  const validate = (): { ok: boolean; errs: ValidationErrors } => {
    const errs: ValidationErrors = {};

    if (!form.name.trim()) {
      errs.name = '活动名称不能为空';
    } else if (form.name.length > 50) {
      errs.name = '活动名称不能超过 50 个字符';
    }

    if (form.start_time && form.end_time) {
      const s = new Date(form.start_time).getTime();
      const e = new Date(form.end_time).getTime();
      if (!isNaN(s) && !isNaN(e) && s >= e) {
        errs.start_time = '开始时间必须早于结束时间';
      }
    }

    if (!form.totalHp || form.totalHp <= 0) errs.totalHp = '总血量必须大于 0';
    if (form.currentHp < 0) errs.currentHp = '当前血量不能为负数';
    if (form.totalHp > 0 && form.currentHp > form.totalHp) errs.currentHp = '当前血量不能大于总血量';

    const propASum = calcSum(form.propA.rows);
    if (Math.abs(propASum - 100) >= 0.001) {
      errs.propA = `概率总和必须等于 100%，当前为 ${propASum.toFixed(1)}%`;
    }
    const propBSum = calcSum(form.propB.rows);
    if (Math.abs(propBSum - 100) >= 0.001) {
      errs.propB = `概率总和必须等于 100%，当前为 ${propBSum.toFixed(1)}%`;
    }

    if (form.milestones.length > 0) {
      const dupErrs = findDuplicateThresholds(form.milestones);
      const idDupErrs = findDuplicateIds(form.milestones);
      errs.milestones = { ...dupErrs, ...idDupErrs };
    }

    const { stage2 = 75, stage3 = 50, stage4 = 25 } = form.spine?.formThresholds ?? {};
    if (!(stage2 > stage3 && stage3 > stage4 && stage2 > 0 && stage3 > 0 && stage4 > 0)) {
      errs.spine = '形态血量阈值必须满足：100% > 阶段2 > 阶段3 > 阶段4 > 0%';
    }

    const msErrKeys = Object.keys(errs.milestones ?? {});
    const ok =
      Object.keys(errs).filter((k) => k !== 'milestones').length === 0 &&
      msErrKeys.length === 0 &&
      !errs.spine;

    return { ok, errs };
  };

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const { ok: valid, errs: freshErrs } = validate();
    if (!valid) {
      // ── REPARK 6.0 (2026-07-29): per-field Toast + scroll + red highlight.
      // Use FRESH errs (returned from validate) so the message reflects the
      // current form state — not a stale closure from a previous render.
      setErrors(freshErrs);

      const broken: { label: string; reason: string; sectionId: string; inputName?: string }[] = [];

      // Helper to register a top-level broken field — caller maps the input by
      // `data-field="<name>"` selector (see BasicInfoSection + BossHPSection).
      const addField = (
        name: 'name' | 'start_time' | 'end_time' | 'totalHp' | 'currentHp' | 'propA' | 'propB' | 'spine',
      ) => {
        const reason = freshErrs[name];
        if (!reason) return;
        const section = FIELD_TO_SECTION[name];
        broken.push({
          label:   FIELD_LABEL[name],
          reason,
          sectionId: section,
          inputName: name,
        });
      };
      addField('name');
      addField('start_time');
      addField('end_time');
      addField('totalHp');
      addField('currentHp');
      addField('propA');
      addField('propB');
      addField('spine');

      const msErrs = freshErrs.milestones ?? {};
      const msIds  = Object.keys(msErrs);
      if (msIds.length > 0) {
        broken.push({
          label:   FIELD_LABEL.milestones,
          reason:  msIds.map((id) => msErrs[id]).join('；'),
          sectionId: FIELD_TO_SECTION.milestones,
        });
      }

      // Detailed toast: "保存失败：[字段名] 原因"
      // Cap to top 4 fields so the toast isn't a wall of text on long forms.
      const TOP_N = 4;
      const detail =
        broken.length === 0
          ? '请修正表单中的错误后再保存'
          : broken
              .slice(0, TOP_N)
              .map((b) => `[${b.label}] ${b.reason}`)
              .join(' · ') +
              (broken.length > TOP_N ? ` · 等 ${broken.length} 处` : '');

      showToast({ type: 'error', message: `保存失败：${detail}` });

      // Auto-scroll to the first broken field's section AND focus + red-border
      // the first sub-input (where `data-field="<name>"` lives).
      const first = broken[0];
      if (first) {
        const smooth = (el: Element | null) => {
          if (el && 'scrollIntoView' in el) {
            (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        };
        const highlight = (el: Element | null) => {
          if (!el) return;
          el.classList.add(
            'ring-2', 'ring-red-500/60', 'border-red-500',
            'shadow-[0_0_0_4px_rgba(239,68,68,0.15)]',
          );
          // Clear highlight after 4s
          setTimeout(() => {
            el.classList.remove(
              'ring-2', 'ring-red-500/60', 'border-red-500',
              'shadow-[0_0_0_4px_rgba(239,68,68,0.15)]',
            );
          }, 4000);
        };

        // Defer so the toast renders first.
        setTimeout(() => {
          const sectionEl = document.getElementById(first.sectionId);
          smooth(sectionEl);

          if (first.inputName) {
            const input = document.querySelector<HTMLElement>(
              `[data-field="${first.inputName}"]`,
            );
            if (input) {
              highlight(input);
              // Focus the actual input element inside the wrapper if any
              const focusable = input.matches('input, textarea, select')
                ? input
                : input.querySelector<HTMLElement>('input, textarea, select');
              focusable?.focus({ preventScroll: true });
            }
          }
        }, 80);
      }

      return;
    }

    setIsSaving(true);
    try {
      const body = {
        id: activityId,
        name:       form.name.trim(),
        start_time: form.start_time,
        end_time:   form.end_time,
        config: {
          isGlobalEnabled: form.isGlobalEnabled,
          rules:           form.rules,
          boss: {
            totalHp:   form.totalHp,
            currentHp: form.currentHp,
          },
          items: {
            propA: {
              name:          form.propA.name,
              rows:          form.propA.rows,
              taskThreshold: form.propA.taskThreshold,
              dailyLimit:   form.propA.dailyLimit,
            },
            propB: {
              name:          form.propB.name,
              rows:          form.propB.rows,
              taskThreshold: form.propB.taskThreshold,
              dailyLimit:   form.propB.dailyLimit,
            },
          },
          milestones: form.milestones,
          spine:     form.spine,
          // REPARK 6.0 (2026-08-14): Only persist non-empty profile rows.
          // The H5 client will fall back to DEFAULT_* values when fields are
          // missing or blank, so we keep the DB payload as compact as possible.
          character_profile: {
            characterName: form.characterProfile.characterName.trim(),
            stageNames: form.characterProfile.stageNames.map((s) => s.trim()),
            bio: form.characterProfile.bio
              .map((b) => ({ label: b.label.trim(), value: b.value.trim() }))
              .filter((b) => b.label.length > 0 || b.value.length > 0),
            skills: form.characterProfile.skills
              .map((s) => ({ name: s.name.trim(), desc: s.desc.trim() }))
              .filter((s) => s.name.length > 0 || s.desc.length > 0),
          },
          // REPARK 7.0 Batch C (2026-08-28): persist the customer-configured
          // 每日自动重置 toggle. Always emit the explicit object so the
          // resolved server-side helper can mirror the operator's intent
          // (ON for legacy activities that default ON).
          dailyReset: { enabled: form.dailyResetEnabled },
        },
      };

      const res  = await adminFetch('/api/admin/activity/update', {
        method: 'PUT',
        body:   JSON.stringify(body),
      });
      const data = await res.json();

      if (!data.ok) {
        // Map server error.code -> ValidationErrors so the field gets the
        // red-border + per-field message treatment the same way validate()
        // does. This makes server-rejected saves look identical to
        // client-rejected saves from the operator's perspective.
        const mapped: ValidationErrors = {
          ...errors,
          ...(data.error?.code === 'INVALID_TIME_RANGE'            ? { start_time: data.error.message } : {}),
          ...(data.error?.code === 'INVALID_TOTAL_HP'             ? { totalHp:    data.error.message } : {}),
          ...(data.error?.code === 'CURRENT_HP_EXCEEDS_TOTAL'     ? { currentHp:  data.error.message } : {}),
          ...(data.error?.code === 'PROBABILITY_SUM_INVALID'      ? {
              [String(data.error.message).match(/闪电符文|propA/i) ? 'propA' : 'propB']: data.error.message,
            } : {}),
          ...(data.error?.code === 'PROBABILITY_OUT_OF_RANGE'     ? {
              [String(data.error.message).match(/闪电符文|propA/i) ? 'propA' : 'propB']: data.error.message,
            } : {}),
          ...(data.error?.code === 'DUPLICATE_MILESTONE_THRESHOLD' ? {
              milestones: { _: data.error.message },
            } : {}),
        };
        setErrors(mapped);

        // Detailed, per-field toast for known codes; generic for unknown.
        const FIELD_LABEL_BY_KEY: Record<string, string> = {
          start_time: '活动开始时间',
          end_time:   '活动结束时间',
          totalHp:    'Boss 总血量',
          currentHp:  'Boss 当前血量',
          propA:      '闪电符文概率',
          propB:      '潮汐晶石概率',
          milestones: '进度奖励',
        };
        const codeToField: Record<string, keyof typeof FIELD_LABEL_BY_KEY> = {
          INVALID_TIME_RANGE:        'start_time',
          INVALID_TOTAL_HP:         'totalHp',
          CURRENT_HP_EXCEEDS_TOTAL: 'currentHp',
          PROBABILITY_SUM_INVALID:  'propA',
          PROBABILITY_OUT_OF_RANGE: 'propA',
          DUPLICATE_MILESTONE_THRESHOLD: 'milestones',
        };
        const fieldKey = codeToField[data.error?.code as string];
        const label = fieldKey ? FIELD_LABEL_BY_KEY[fieldKey] : undefined;
        showToast({
          type: 'error',
          message: label
            ? `保存失败：[${label}] ${data.error.message ?? '校验未通过'}`
            : (data.error?.message ?? '保存失败'),
        });
        return;
      }

      showToast({ type: 'success', message: '配置已保存' });
      setErrors({});
    } catch {
      showToast({ type: 'error', message: '网络错误，请稍后重试' });
    } finally {
      setIsSaving(false);
    }
  };

  // ── REPARK 6.0 (2026-08-22): Global Ctrl+S / Cmd+S to save ──────────
  // Without this, hitting the browser-default "Save Page" dialog while
  // typing in any input is jarring and operators lose unsaved edits.
  // Placed AFTER handleSave declaration to avoid TDZ.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Listen for Ctrl+S / Cmd+S (no Shift/Alt — keep modifiers minimal so
      // we don't hijack dev tool combos or alternative save paths).
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (!isSaving && !isLoading) {
          handleSave();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, isSaving, isLoading]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const msErrorsExist = Object.keys(errors.milestones ?? {}).length > 0;
  const saveBlocked  = Object.keys(errors).length > 0 || msErrorsExist;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    // REPARK 6.0 (2026-08-23) P1: viewport lock is now owned by .admin-main
    // in admin.css (height:100vh, overflow-y:auto). This page uses h-full so
    // it fills the parent's available space without re-declaring a viewport
    // height that could mismatch the global layout's horizontal margin.
    <div className="flex h-full w-full overflow-hidden bg-[#0d1117]">

      {/* ── Left Sidebar ─────────────────────────────────────────────────── */}
      <aside className="w-[220px] shrink-0 h-full bg-[#161b22] border-r border-[#30363d] flex flex-col overflow-y-auto">
        <div className="p-4 border-b border-[#30363d]">
          <Link href="/admin/activities"
                className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
            <ChevronLeft size={14} />
            返回活动列表
          </Link>
        </div>

        {activity && (
          <div className="px-4 py-3 border-b border-[#30363d]">
            <div className="text-xs text-gray-500 mb-0.5">当前编辑</div>
            <div className="text-sm font-semibold text-white leading-tight">{activity.name}</div>
            <div className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              activity.type === 'LIVE2D' ? 'bg-pink-500/15 text-pink-400' : 'bg-amber-500/15 text-amber-400'
            }`}>
              {activity.type === 'LIVE2D' ? '🎭 Spine 互动' : '⚡ 消耗电量'}
            </div>
          </div>
        )}

        <nav className="flex-1 p-3 space-y-1">
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            配置分组
          </div>

            {([
              { id: 'section-basic',       icon: Activity, label: '基本信息', color: 'pink' },
              { id: 'section-items',       icon: Package,  label: '道具配置', color: 'blue'  },
              { id: 'section-milestones',  icon: Flag,      label: '进度奖励',   color: 'amber' },
              { id: 'section-profile',     icon: User,      label: '角色档案', color: 'cyan' },
              { id: 'section-banners',    icon: Image,     label: 'Banner 管理', color: 'purple' },
            ] as const).map(({ id, icon: Icon, label, color }) => {
            const activeCls = {
              pink:    `bg-pink-500/20 border-pink-500/30 text-pink-300${activeSection === id ? ' ring-1 ring-pink-500/40' : ''}`,
              blue:    `bg-blue-500/20 border-blue-500/30 text-blue-300${activeSection === id ? ' ring-1 ring-blue-500/40' : ''}`,
              amber:   `bg-amber-500/20 border-amber-500/30 text-amber-300${activeSection === id ? ' ring-1 ring-amber-500/40' : ''}`,
              cyan:    `bg-cyan-500/20 border-cyan-500/30 text-cyan-300${activeSection === id ? ' ring-1 ring-cyan-500/40' : ''}`,
              purple:  `bg-purple-500/20 border-purple-500/30 text-purple-300${activeSection === id ? ' ring-1 ring-purple-500/40' : ''}`,
            }[color];
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-white border transition-all cursor-pointer ${activeCls}`}
              >
                <Icon size={15} />
                {label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ── Right Content ───────────────────────────────────────────────── */}
      <main className="flex-1 h-full overflow-y-auto flex flex-col min-w-0">
        <div className="sticky top-0 z-30 bg-[#0d1117]/95 backdrop-blur-md border-b border-[#30363d]
                        px-8 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-white">活动配置</h1>
            {activity && (
              <p className="text-xs text-gray-500 mt-0.5">
                ID {activity.id} · {activity.status === 'ENABLED' ? '已启用' : '已禁用'}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchActivity}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-400
                         border border-[#30363d] hover:text-white hover:border-gray-500 transition-all cursor-pointer"
            >
              <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
              重置
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isLoading}
              title={saveBlocked ? '请先修正所有表单错误' : ''}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold
                         bg-pink-500 hover:bg-pink-600
                         disabled:bg-pink-500/40 disabled:cursor-not-allowed
                         text-white shadow-lg shadow-pink-500/20 transition-all cursor-pointer"
            >
              {isSaving ? (
                <><RefreshCw size={13} className="animate-spin" />保存中…</>
              ) : (
                <><Save size={13} />保存配置</>
              )}
            </button>
          </div>
        </div>

        <div className="flex-1 px-8 py-6 space-y-8 max-w-5xl">

          {fetchErr && (
            <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-xl
                            bg-red-500/10 border border-red-500/25 text-red-300 text-sm">
              <AlertTriangle size={16} className="text-red-400 shrink-0" />
              <span>{fetchErr}</span>
              <button type="button" onClick={fetchActivity}
                      className="ml-auto text-red-400 hover:text-red-300 underline cursor-pointer">
                重试
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-6 animate-pulse">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="space-y-3">
                  <div className="h-4 bg-[#21262d] rounded w-24" />
                  <div className="h-11 bg-[#21262d] rounded-xl" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Basic Info */}
              <div id="section-basic" className="mb-8 scroll-mt-24">
                <BasicInfoSection form={form} errors={errors} onField={onField} />
              </div>

              <div className="border-t border-[#21262d] mb-8" />

              {/* Boss HP */}
              {activity?.type === 'LIVE2D' ? (
                <div id="section-boss" className="scroll-mt-24">
                  <BossHPSection form={form} errors={errors} onField={onField} />
                </div>
              ) : (
                <div id="section-boss" className="scroll-mt-24">
                  <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/25 rounded-xl mb-8">
                    <AlertTriangle size={16} className="text-amber-400 shrink-0" />
                    <p className="text-sm text-amber-300">
                      Boss 血量管理仅适用于 <strong>Spine 互动</strong> 类型活动（当前为「消耗电量」）
                    </p>
                  </div>
                </div>
              )}

              <div className="border-t border-[#21262d] mb-8" />

              {/* Item Config */}
              <div id="section-items" className="mb-8 scroll-mt-24">
                <ItemConfigSection
                  form={form}
                  errors={errors}
                  onPropRows={onPropRows}
                  onPropTaskThreshold={onPropTaskThreshold}
                  onPropDailyLimit={onPropDailyLimit}
                  onPropNameChange={onPropNameChange}
                />
              </div>

              <div className="border-t border-[#21262d] mb-8" />

              {/* Milestones */}
              <div id="section-milestones" className="scroll-mt-24" data-field="milestones">
                <MilestonesSection
                  form={form}
                  errors={errors}
                  onMilestonesChange={onMilestonesChange}
                />
              </div>

              <div className="border-t border-[#21262d] mb-8" />

              {/* Spine threshold config */}
              <SpineSection
                form={{ spine: form.spine }}
                errors={errors}
                onSpineChange={onSpineChange}
              />

              <div className="border-t border-[#21262d] mb-8" />

              {/* REPARK 6.0 (2026-08-14): Character Profile config (stage names / bio / skills) */}
              <div id="section-profile" className="scroll-mt-24">
                <CharacterProfileSection
                  profile={form.characterProfile}
                  onChange={(cp) => setForm((p) => ({ ...p, characterProfile: cp }))}
                />
              </div>

              <div className="border-t border-[#21262d] mb-8" />

              {/* Banner */}
              <div id="section-banners" className="scroll-mt-24">
                <section className="space-y-4">
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Image size={16} className="text-purple-400" />
                    Banner 管理
                  </h2>
                  <p className="text-xs text-gray-500 -mt-2">
                    关联到此活动的 Banner 列表。可在 <Link href="/admin/banners" className="text-pink-400 hover:text-pink-300 underline">Banner 管理页面</Link> 创建或编辑 Banner。
                  </p>

                  {banners.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 rounded-xl border border-dashed border-[#30363d] bg-[#161b22]/30">
                      <Image size={28} className="text-[#484f58] mb-2" />
                      <p className="text-sm text-[#484f58] mb-3">此活动暂无关联的 Banner</p>
                      <Link
                        href="/admin/banners"
                        className="px-4 py-2 bg-pink-500/15 hover:bg-pink-500/25 text-pink-400 text-sm font-medium rounded-lg border border-pink-500/30 transition-colors"
                      >
                        去 Banner 管理页面创建
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {banners.map((banner) => (
                        <div
                          key={banner.id}
                          className={`flex items-center gap-3 p-3 rounded-xl border ${
                            banner.isEnabled
                              ? 'border-purple-500/30 bg-[#161b22]'
                              : 'border-[#30363d]/60 bg-[#0d1117]/60 opacity-60'
                          }`}
                        >
                          {banner.imageUrl ? (
                            <img
                              src={banner.imageUrl}
                              alt={`Banner for activity ${banner.id}`}
                              className="w-16 h-10 rounded object-cover shrink-0 border border-[#30363d]"
                            />
                          ) : (
                            <div className="w-16 h-10 rounded bg-[#21262d] flex items-center justify-center shrink-0">
                              <Image size={14} className="text-gray-600" aria-hidden="true" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-white font-medium truncate">{banner.imageUrl || '未上传图片'}</span>
                              {banner.isEnabled ? (
                                <span className="px-1.5 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded">展示中</span>
                              ) : (
                                <span className="px-1.5 py-0.5 text-[10px] bg-gray-700/40 text-gray-500 rounded">已隐藏</span>
                              )}
                              {banner.showCountdown && (
                                <span className="px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-400 rounded">倒计时</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">排序: {banner.sortWeight} · ID: {banner.id.slice(0, 8)}</div>
                          </div>
                          <Link
                            href="/admin/banners"
                            className="shrink-0 px-3 py-1.5 text-xs text-pink-400 hover:text-pink-300 border border-pink-500/30 hover:border-pink-500/50 rounded-lg transition-colors"
                          >
                            编辑
                          </Link>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </main>

      <Toast toast={toast} />
    </div>
  );
}

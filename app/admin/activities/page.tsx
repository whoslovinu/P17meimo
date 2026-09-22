'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/app/admin/lib/adminApi';
import toast from 'react-hot-toast';
import {
  Plus, Edit2, Trash2, X, CheckCircle, AlertTriangle,
  RefreshCw, ShieldAlert, PlayCircle, Rocket, Crown, Trophy, Zap, Award, Send,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────
type ActivityType   = 'LIVE2D' | 'ENERGY';
type ActivityStatus = 'ENABLED' | 'DISABLED';

interface Activity {
  id:         number;
  name:       string;
  type:       ActivityType;
  start_time: string;
  end_time:   string;
  status:     ActivityStatus;
  created_at: string;
  config?: {
    isGlobalEnabled?: boolean;
    milestones?: Array<{
      id: string | number;
      threshold: number;
      rewardType: 'ENERGY' | 'MEDAL';
      energyValue?: number;
      medalId?: string;
    }>;
    [key: string]: unknown;
  };
}

interface FinalizeMilestoneSummary {
  milestoneId: number;
  threshold: number;
  rewardType: 'ENERGY' | 'MEDAL';
  rewardValue: string;
  eligibleUsers: number;
  newlyClaimed: number;
  dryRun: boolean;
}

interface FinalizeTop10Entry {
  rank: number;
  userId: string;
  nickname: string;
  avatar: string;
  totalDamage: number;
  milestonesUnlocked: number;
  projectedReward: {
    milestoneId: number;
    threshold: number;
    rewardType: 'ENERGY' | 'MEDAL';
    rewardValue: string;
  } | null;
}

interface FinalizeResult {
  activityId: number;
  dryRun: boolean;
  finalizedAt: string;
  milestones: FinalizeMilestoneSummary[];
  totalEligible?: number;
  rewardsByType?: { energy_total: number; medal_total: number };
  top10?: FinalizeTop10Entry[];
  activityEndTime?: string;
  dryRunBypassedActivityEnd?: boolean;
}

interface ActivityFormData {
  name:       string;
  type:       ActivityType;
  start_time: string;
  end_time:   string;
}

// ── Constants ──────────────────────────────────────────────────────────────────
const NAME_MAX_LENGTH = 50;

// ── Defensive helpers (P0 2026-07-30 容错) ─────────────────────────────────────
// `safeNum` / `safeStr` / `safeArr` 在解析后端任意字段时保证不抛错：
//   - safeNum(null)  → 0
//   - safeStr(null)  → ''
//   - safeArr(null)  → []
// 这些函数是模块级 pure，Modal 与 runSettlement 共享。
function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function safeStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function safeArr<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function formatDate(iso: string) {
  if (!iso) return <span className="text-zinc-600">—</span>;
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function getActivitySettlementStatus(endTime: string) {
  const ended = new Date(endTime).getTime() <= Date.now();
  return {
    ended,
    label: ended ? '已结束，可结算' : '进行中，默认不可正式结算',
  };
}

// ── Delete Confirmation Dialog ───────────────────────────────────────────────────
function DeleteDialog({
  activity, onConfirm, onCancel, isDeleting,
}: {
  activity: Activity;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting: boolean;
}) {
  const isEnabled = activity.status === 'ENABLED';
  return (
    <div className="admin-modal-backdrop">
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-red-950/40 border border-red-800/50 flex items-center justify-center">
            <Trash2 size={16} className="text-red-400" />
          </div>
          <h3 className="admin-modal-title">确认删除活动</h3>
        </div>
        <p className="admin-modal-desc">
          确定要删除「<span className="text-zinc-100 font-medium">{activity.name}</span>」吗？此操作不可撤销。
        </p>
        {isEnabled && (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 mb-4 text-xs text-zinc-400">
            <AlertTriangle size={13} className="text-zinc-500 mt-0.5 shrink-0" />
            <p>
              该活动正在启用中（{activity.type === 'LIVE2D' ? 'Spine 互动' : '消耗电量'}）。删除后请前往配置页关闭对应入口。
            </p>
          </div>
        )}
        <div className="admin-modal-actions">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="admin-btn admin-btn-secondary"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="admin-btn admin-btn-danger"
          >
            {isDeleting ? (
              <><RefreshCw size={13} className="animate-spin" />删除中…</>
            ) : (
              <><Trash2 size={13} />确认删除</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dry Run 演练报告 Modal (P0 2026-07-30) ──────────────────────────────────────
/**
 * 展示 Dry Run 试算的完整明细：milestone 补发统计 + top-10 排行榜 + 安全只读标签。
 *
 * P0 2026-07-30 防崩容错：所有列表渲染前都经过 `safeArr()` / `safeNum()` 守门；
 * 当 result.milestones / result.top10 是 undefined（后端 409 / 500 时的旧 state
 * 残留或跨组件 prop 重渲染）时，绝不抛错，而是显示友好的"数据缺失"提示。
 */
function DryRunReportModal({
  activity, result, error, onClose,
}: {
  activity: Activity;
  result: FinalizeResult | null;
  error?: { code?: string; message: string; httpStatus?: number } | null;
  onClose: () => void;
}) {
  // ── Defensive normalisers (use module-level safe* helpers) ───────────────────
  const milestones = safeArr<FinalizeMilestoneSummary>(result?.milestones);
  const top10      = safeArr<FinalizeTop10Entry>(result?.top10);
  const podium3    = top10.slice(0, 3);

  const totalEligible      = safeNum(result?.totalEligible);
  const rewardsByType      = (result?.rewardsByType && typeof result.rewardsByType === 'object')
                             ? {
                                 energy_total: safeNum((result.rewardsByType as { energy_total?: unknown }).energy_total),
                                 medal_total:  safeNum((result.rewardsByType as { medal_total?: unknown }).medal_total),
                               }
                             : { energy_total: 0, medal_total: 0 };
  const bypassed           = result?.dryRunBypassedActivityEnd === true;
  const activityEndTimeStr = result?.activityEndTime ?? null;

  // Determine whether to render a "data unavailable" fallback instead of the
  // tables. Triggers: explicit error prop, or missing milestones with no
  // top10 either (signals a stale/incomplete payload).
  const showErrorState = error != null
    || (result == null)
    || (milestones.length === 0 && top10.length === 0 && !bypassed && totalEligible === 0 && !result?.rewardsByType);

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div
        className="admin-modal max-w-3xl"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4 gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              showErrorState
                ? 'bg-red-950/50 border border-red-800/60'
                : 'bg-emerald-950/50 border border-emerald-700/50'
            }`}>
              {showErrorState
                ? <AlertTriangle size={20} className="text-red-400" />
                : <PlayCircle size={20} className="text-emerald-400" />}
            </div>
            <div>
              <h3 className="admin-modal-title">
                {showErrorState ? 'Dry Run 演练失败' : 'Dry Run 演练报告'}
              </h3>
              <p className="mt-0.5 text-xs text-zinc-500">
                活动「<span className="text-zinc-300">{activity.name}</span>」 · {showErrorState ? '未获得试算结果' : '仅试算，未写入数据库'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="p-1.5 text-zinc-500 hover:text-zinc-100 rounded-md transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Error banner — ONLY when backend returned a non-200 (409 / 500 / etc.) */}
        {showErrorState && (
          <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg border border-red-800/60 bg-red-950/30 mb-5">
            <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
            <div className="text-xs text-red-200/90">
              <div className="font-semibold text-red-300">
                演练报告无法生成
              </div>
              <div className="mt-1 text-red-200/80 leading-relaxed">
                {error?.message ?? '后端返回的数据不完整（可能是网络中断、服务重启或上游返回 5xx）。请稍后再试或联系值班工程。'}
                {error?.httpStatus === 409 && (
                  <span className="block mt-1.5 text-amber-300/90">
                    提示：HTTP 409 通常代表当前活动状态不允许试算。Dry Run 应支持任意时刻试算；如再次出现 409，请检查后端 `/api/admin/activity/finalize` 的 dryRun 分支是否正确绕过 ACTIVITY_NOT_ENDED 校验。
                  </span>
                )}
                {error?.code && (
                  <span className="block mt-1 text-zinc-400 font-mono">
                    错误代码: {error.code}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Safe-mode banner — only when we have a successful payload */}
        {!showErrorState && (
          <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg border border-emerald-800/60 bg-emerald-950/30 mb-5">
            <ShieldAlert size={14} className="text-emerald-400 mt-0.5 shrink-0" />
            <div className="text-xs text-emerald-300/90">
              <div className="font-semibold text-emerald-300">
                [只读演练模式：数据未写入数据库，可放心测试]
              </div>
              <div className="mt-0.5 text-emerald-300/70">
                本次仅查询 PostgreSQL 统计快照，所有 INSERT/UPDATE 已被绕过。
                {bypassed && (
                  <span className="block mt-1 text-amber-300/80">
                    ⚠ 活动尚未结束（结束时间 {activityEndTimeStr ? new Date(activityEndTimeStr).toLocaleString('zh-CN') : '—'}），dryRun 跳过了 409 校验。
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Top-line metrics */}
        {!showErrorState && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider">总受惠玩家</div>
              <div className="mt-1 font-mono text-lg text-zinc-100">{totalEligible.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider">预计发放电量</div>
              <div className="mt-1 font-mono text-lg text-amber-300">
                {rewardsByType.energy_total.toLocaleString()} <span className="text-xs text-zinc-500">pt</span>
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider">预计发放勋章</div>
              <div className="mt-1 font-mono text-lg text-zinc-100">
                {rewardsByType.medal_total.toLocaleString()} <span className="text-xs text-zinc-500">枚</span>
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Milestone 数</div>
              <div className="mt-1 font-mono text-lg text-zinc-100">{milestones.length}</div>
            </div>
          </div>
        )}

        {/* Milestone breakdown */}
        {!showErrorState && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <Award size={14} className="text-zinc-400" />
              <h4 className="text-sm font-medium text-zinc-200">里程碑补发统计</h4>
            </div>
            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <table className="admin-table min-w-[480px]">
                <thead>
                  <tr>
                    <th>Milestone</th>
                    <th>阈值</th>
                    <th>奖励</th>
                    <th>预计补发</th>
                  </tr>
                </thead>
                <tbody>
                  {milestones.length === 0 ? (
                    <tr><td colSpan={4} className="text-center text-zinc-500 py-6">未配置里程碑</td></tr>
                  ) : milestones.map((m) => (
                    <tr key={`${safeNum(m.milestoneId)}-${safeNum(m.threshold)}`}>
                      <td className="font-mono">#{safeNum(m.milestoneId)}</td>
                      <td className="font-mono">{safeNum(m.threshold).toLocaleString()}</td>
                      <td>
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] ${
                          m.rewardType === 'ENERGY'
                            ? 'bg-amber-950/40 border border-amber-800/40 text-amber-300'
                            : 'bg-violet-950/40 border border-violet-800/40 text-violet-300'
                        }`}>
                          {m.rewardType === 'ENERGY' ? <Zap size={10} /> : <Trophy size={10} />}
                          {m.rewardType === 'ENERGY' ? `${m.rewardValue ?? '0'} pt` : `勋章 ${m.rewardValue ?? '?'}`}
                        </span>
                      </td>
                      <td className="font-mono text-zinc-100">{safeNum(m.eligibleUsers).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Top-10 leaderboard preview */}
        {!showErrorState && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <Trophy size={14} className="text-amber-400" />
              <h4 className="text-sm font-medium text-zinc-200">
                排行榜前 10 名玩家试算清单
              </h4>
            </div>
            {top10.length === 0 ? (
              <div className="text-xs text-zinc-500 px-3 py-4 rounded-lg border border-zinc-800 bg-zinc-900/40 text-center">
                暂无玩家伤害数据
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="admin-table min-w-[640px]">
                  <thead>
                    <tr>
                      <th className="w-12">Rank</th>
                      <th>玩家</th>
                      <th>伤害</th>
                      <th>已解锁里程碑</th>
                      <th>拟发放奖励</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top10.map((entry, idx) => {
                      // ── Defensive per-row guards ──
                      const rank      = safeNum(entry?.rank, idx + 1);
                      const userId    = entry?.userId ?? `unknown-${idx}`;
                      const nickname  = entry?.nickname ?? '神秘玩家';
                      const avatar    = entry?.avatar   ?? '👤';
                      const dmg       = safeNum(entry?.totalDamage);
                      const unlocked  = safeNum(entry?.milestonesUnlocked);
                      const projected = entry?.projectedReward ?? null;
                      const isPodium  = rank <= 3;
                      return (
                        <tr key={userId} className={isPodium ? 'bg-amber-950/10' : ''}>
                          <td>
                            <span className={`inline-flex items-center gap-1 font-mono ${
                              rank === 1 ? 'text-amber-300' :
                              rank === 2 ? 'text-zinc-200' :
                              rank === 3 ? 'text-orange-300' : 'text-zinc-400'
                            }`}>
                              {rank === 1 && <Crown size={12} className="text-amber-300" />}
                              #{rank}
                            </span>
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <span className="text-base">{avatar}</span>
                              <span className="text-zinc-100">{nickname}</span>
                            </div>
                          </td>
                          <td className="font-mono">{dmg.toLocaleString()}</td>
                          <td className="font-mono text-zinc-300">{unlocked}</td>
                          <td>
                            {projected ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-emerald-950/40 border border-emerald-800/40 text-emerald-300">
                                <Zap size={10} />
                                {projected.rewardType === 'ENERGY'
                                  ? `${projected.rewardValue ?? '0'} pt`
                                  : `勋章 ${projected.rewardValue ?? '?'}`}
                              </span>
                            ) : (
                              <span className="text-xs text-zinc-500">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {podium3.length > 0 && (
              <div className="mt-3 text-[11px] text-zinc-500">
                🏆 Top 3: {podium3.map((p, i) => `${p?.nickname ?? `玩家${i + 1}`} (${safeNum(p?.totalDamage).toLocaleString()})`).join('  ·  ')}
              </div>
            )}
          </div>
        )}

        <div className="admin-modal-actions">
          <button
            onClick={onClose}
            className="admin-btn admin-btn-secondary"
          >
            {showErrorState ? '关闭' : '关闭演练报告'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create / Edit Modal ─────────────────────────────────────────────────────────
function ActivityModal({
  editing, form, nameLen, onField, onSave, onClose, isSaving,
}: {
  editing: Activity | null;
  form: ActivityFormData;
  nameLen: number;
  onField: (field: keyof ActivityFormData, value: string) => void;
  onSave: () => void;
  onClose: () => void;
  isSaving: boolean;
}) {
  const isNameOver = nameLen > NAME_MAX_LENGTH;
  const isNameWarn = nameLen > NAME_MAX_LENGTH * 0.8 && !isNameOver;
  const canSave = !isSaving
    && form.name.trim().length > 0
    && !isNameOver
    && form.start_time
    && form.end_time;
  const isEdit = editing !== null;

  const defaultDates = () => {
    const now = new Date();
    const later = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return {
      start: now.toISOString().slice(0, 16),
      end: later.toISOString().slice(0, 16),
    };
  };

  return (
    <div className="admin-modal-backdrop">
      <div className="admin-modal max-w-md" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="admin-modal-title">{isEdit ? '编辑活动' : '新增活动'}</h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="p-1.5 text-zinc-500 hover:text-zinc-100 rounded-md transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="admin-label">活动名称 *</label>
            <div className="relative">
              <input
                type="text"
                value={form.name}
                onChange={(e) => onField('name', e.target.value)}
                placeholder="例如：夏日狂欢节"
                maxLength={NAME_MAX_LENGTH + 10}
                className={`admin-input ${isNameOver ? 'border-red-800 focus:border-red-700' : ''}`}
              />
              <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono ${
                isNameOver ? 'text-red-400' : isNameWarn ? 'text-zinc-400' : 'text-zinc-600'
              }`}>
                {nameLen}/{NAME_MAX_LENGTH}
              </span>
            </div>
            {isNameOver && (
              <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                <AlertTriangle size={11} />
                活动名称不能超过 50 个字符
              </p>
            )}
          </div>

          {/* Type Selector */}
          <div>
            <label className="admin-label">活动类型 *</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'LIVE2D', label: 'Spine 互动', sub: 'BOSS 对战', icon: '🎭' },
                { value: 'ENERGY', label: '消耗电量', sub: '能量消耗', icon: '⚡' },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onField('type', opt.value);
                    if (!editing) {
                      const d = defaultDates();
                      onField('start_time', d.start);
                      onField('end_time', d.end);
                    }
                  }}
                  className={`relative flex items-center gap-2.5 p-3 rounded-lg border transition-colors text-left ${
                    form.type === opt.value
                      ? 'border-zinc-100 bg-zinc-900'
                      : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
                  }`}
                >
                  <span className="text-lg">{opt.icon}</span>
                  <div className="flex-1">
                    <div className={`text-sm font-medium ${form.type === opt.value ? 'text-zinc-100' : 'text-zinc-300'}`}>
                      {opt.label}
                    </div>
                    <div className="text-[11px] text-zinc-500">{opt.sub}</div>
                  </div>
                  {form.type === opt.value && <CheckCircle size={14} className="text-zinc-100" />}
                </button>
              ))}
            </div>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="admin-label">开始时间 *</label>
              <input
                type="datetime-local"
                value={form.start_time}
                onChange={(e) => onField('start_time', e.target.value)}
                className="admin-input"
              />
            </div>
            <div>
              <label className="admin-label">结束时间 *</label>
              <input
                type="datetime-local"
                value={form.end_time}
                onChange={(e) => onField('end_time', e.target.value)}
                className="admin-input"
              />
            </div>
          </div>
        </div>

        <div className="admin-modal-actions mt-6">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="admin-btn admin-btn-secondary"
          >
            取消
          </button>
          <button
            onClick={onSave}
            disabled={!canSave}
            className="admin-btn admin-btn-primary"
          >
            {isSaving ? (
              <><RefreshCw size={13} className="animate-spin" />保存中…</>
            ) : (
              <><CheckCircle size={13} />{isEdit ? '保存修改' : '创建活动'}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Finalize Confirmation Dialog ────────────────────────────────────────────────
function FinalizeConfirmDialog({
  activity, isSubmitting, onCancel, onConfirm,
}: {
  activity: Activity;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="admin-modal-backdrop">
      <div className="admin-modal max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3 text-zinc-100">
          <ShieldAlert size={16} className="text-red-400" />
          <h3 className="admin-modal-title">确认正式发奖</h3>
        </div>
        <p className="admin-modal-desc">
          你即将对活动「<span className="text-zinc-100 font-medium">{activity.name}</span>」执行正式奖励结算。
        </p>
        <div className="px-3 py-2.5 rounded-lg bg-red-950/30 border border-red-800/50 text-xs text-red-200 mb-4">
          此操作不可撤销：将按当前活动配置中的 milestone 阈值进行批量发奖。
        </div>
        <ul className="text-xs text-zinc-500 space-y-1 list-disc pl-5 mb-5">
          <li>按当前活动配置中的 milestone 阈值进行批量发奖</li>
          <li>写入用户里程碑领取状态并发放奖励</li>
          <li>该操作具备幂等性，但仍属于高风险运营动作</li>
        </ul>
        <div className="admin-modal-actions">
          <button onClick={onCancel} disabled={isSubmitting} className="admin-btn admin-btn-secondary">取消</button>
          <button onClick={onConfirm} disabled={isSubmitting} className="admin-btn admin-btn-danger">
            {isSubmitting ? <><RefreshCw size={13} className="animate-spin" />发奖中…</> : <><Rocket size={13} />确认正式发奖</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────────
export default function AdminActivitiesPage() {
  const router = useRouter();

  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading,   setIsLoading]   = useState(true);
  const [fetchError,  setFetchError]  = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editing,   setEditing]   = useState<Activity | null>(null);
  const [isSaving,   setIsSaving]   = useState(false);
  const [form, setForm] = useState<ActivityFormData>({
    name: '', type: 'LIVE2D', start_time: '', end_time: '',
  });

  const [deleteTarget, setDeleteTarget] = useState<Activity | null>(null);
  const [isDeleting,    setIsDeleting]   = useState(false);

  const [settlementResult,        setSettlementResult]        = useState<FinalizeResult | null>(null);
  const [isSubmittingSettlement,  setIsSubmittingSettlement]  = useState(false);
  const [finalizeTarget,          setFinalizeTarget]          = useState<Activity | null>(null);

  // REPARK 7.0 (2026-09-12): 「指定补发」面板状态。
  //   复用现有 grantBadge()，不发新模块，仅做运营手工补发。
  const [showDirectGrant,         setShowDirectGrant]         = useState(false);
  const [directGrantIdentifier,   setDirectGrantIdentifier]   = useState('');
  const [directGrantBadgeId,      setDirectGrantBadgeId]      = useState('');
  const [isSubmittingDirectGrant, setIsSubmittingDirectGrant] = useState(false);
  const [directGrantResult,       setDirectGrantResult]       = useState<{
    ok: boolean;
    summary: string;
    detail?: string;
  } | null>(null);
  // P0 2026-07-30: 演练报告 Modal — Dry Run 完成时弹出清晰的发奖明细。
  //   `result === null && error !== null` → Modal 渲染为错误态（红底 banner）。
  //   `result !== null && error === null` → 渲染为正常明细。
  const [dryRunReportTarget, setDryRunReportTarget] = useState<{
    activity: Activity;
    result: FinalizeResult | null;
    error: { code?: string; message: string; httpStatus?: number } | null;
  } | null>(null);

  const fetchActivities = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const res  = await adminFetch('/api/admin/activity');
      const data = await res.json();
      if (data.ok) {
        setActivities(data.data ?? []);
      } else {
        const msg = data.error?.message ?? '加载失败';
        setFetchError(msg);
        toast.error(msg);
      }
    } catch {
      const msg = '网络错误，请稍后重试';
      setFetchError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  const resetForm = () => {
    setForm({ name: '', type: 'LIVE2D', start_time: '', end_time: '' });
    setEditing(null);
  };

  const openCreate = () => {
    resetForm();
    const now = new Date();
    const later = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    setForm({
      name: '',
      type: 'LIVE2D',
      start_time: now.toISOString().slice(0, 16),
      end_time: later.toISOString().slice(0, 16),
    });
    setShowModal(true);
  };

  const openEdit = (act: Activity) => {
    if (act.type === 'LIVE2D') {
      toast.success('正在跳转至配置页…');
      router.push(`/admin/activities/${act.id}/config`);
      return;
    }
    setEditing(act);
    setForm({
      name: act.name,
      type: act.type,
      start_time: act.start_time?.slice(0, 16) ?? '',
      end_time:   act.end_time?.slice(0, 16) ?? '',
    });
    setShowModal(true);
  };

  const handleField = (field: keyof ActivityFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!form.name.trim() || form.name.length > NAME_MAX_LENGTH) return;
    setIsSaving(true);
    try {
      const isEdit = editing !== null;
      const url    = isEdit ? '/api/admin/activity/update' : '/api/admin/activity';
      const method = isEdit ? 'PUT' : 'POST';
      const body   = isEdit
        ? JSON.stringify({ id: editing.id, name: form.name.trim(), type: form.type, start_time: form.start_time, end_time: form.end_time })
        : JSON.stringify({ name: form.name.trim(), type: form.type, start_time: form.start_time, end_time: form.end_time });

      const res  = await adminFetch(url, { method, body });
      const data = await res.json();

      if (!data.ok) {
        if (data.error?.code === 'NAME_TOO_LONG') {
          toast.error('活动名称不能超过 50 个字符');
        } else {
          toast.error(data.error?.message ?? '保存失败');
        }
        return;
      }

      toast.success(isEdit ? '活动已更新' : '活动已创建');
      setShowModal(false);
      resetForm();
      await fetchActivities();

      if (!isEdit && form.type === 'LIVE2D') {
        const newId = data.data?.id;
        setTimeout(() => {
          router.push(newId ? `/admin/activities/${newId}/config` : '/admin/activities');
        }, 600);
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetActive = async (act: Activity) => {
    const prev = [...activities];
    setActivities((p) =>
      p.map((a) => ({ ...a, config: { ...a.config, isGlobalEnabled: a.id === act.id } })),
    );
    try {
      const res = await adminFetch(`/api/admin/activity/set-active?id=${act.id}`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        toast.success(`「${act.name}」已设为当前活动`);
      } else {
        setActivities(prev);
        toast.error(data.error?.message ?? '设置失败');
      }
    } catch {
      setActivities(prev);
      toast.error('网络错误');
    }
  };

  const handleToggleStatus = async (act: Activity) => {
    const newStatus: ActivityStatus = act.status === 'ENABLED' ? 'DISABLED' : 'ENABLED';
    setActivities((prev) =>
      prev.map((a) => a.id === act.id ? { ...a, status: newStatus } : a),
    );
    try {
      const res  = await adminFetch('/api/admin/activity/update', {
        method: 'PUT',
        body: JSON.stringify({ id: act.id, status: newStatus }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`活动已${newStatus === 'ENABLED' ? '启用' : '禁用'}`);
      } else {
        setActivities((prev) => prev.map((a) => a.id === act.id ? { ...a, status: act.status } : a));
        toast.error(data.error?.message ?? '状态更新失败');
      }
    } catch {
      setActivities((prev) => prev.map((a) => a.id === act.id ? { ...a, status: act.status } : a));
      toast.error('网络错误');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res  = await adminFetch(`/api/admin/activity/update?id=${deleteTarget.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) {
        if (data.error?.code === 'ACTIVITY_ENABLED') {
          toast.error('请先禁用活动再删除');
        } else {
          toast.error(data.error?.message ?? '删除失败');
        }
        return;
      }
      toast.success('活动已删除');
      setDeleteTarget(null);
      await fetchActivities();
    } catch {
      toast.error('网络错误');
    } finally {
      setIsDeleting(false);
    }
  };

  const runSettlement = async (activity: Activity, dryRun: boolean) => {
    setIsSubmittingSettlement(true);
    try {
      // P0 2026-07-30 容错：解析前先检查 HTTP status code，确保 409/4xx/5xx 走专门的 toast 路径。
      let res: Response;
      try {
        res = await adminFetch('/api/admin/activity/finalize', {
          method: 'POST',
          body: JSON.stringify({ activityId: activity.id, dryRun }),
        });
      } catch (networkErr) {
        // Network-level failure (offline, DNS, CORS, abort). Show a friendly
        // toast and an error-state Modal so the operator can copy the message.
        const message = networkErr instanceof Error ? networkErr.message : '网络错误，请稍后重试';
        toast.error(`演练失败：${message}`);
        setDryRunReportTarget({
          activity,
          result: null,
          error: { message: `网络异常：${message}`, httpStatus: 0 },
        });
        return;
      }

    const httpStatus = res.status;
    let data: { ok: boolean; data?: unknown; error?: { code?: string; message?: string } } = { ok: false };
    try {
      data = await res.json();
    } catch {
      // Body was not JSON — keep the default {ok:false}
    }

    if (!data.ok) {
      // P0 2026-07-30 容错：拆解后端 error.code / error.message，给出最具体的 toast，
      // 并打开 Modal 渲染为红底 banner，让运营一眼看到错误码。
      const code    = data.error?.code ?? 'UNKNOWN';
      const message = data.error?.message ?? (dryRun ? '预演结算失败' : '正式发奖失败');
      const label   = dryRun ? '演练失败' : '正式发奖失败';
      toast.error(`${label}：${message} (${httpStatus} ${code})`);

      // 仅在 dryRun 时打开 Modal 让运营看到完整错误；正式发奖失败仅 toast。
      if (dryRun) {
        setDryRunReportTarget({
          activity,
          result: null,
          error: { code, message, httpStatus },
        });
      }
      return;
    }

    // Map the backend response shape to the frontend `FinalizeResult` type.
    const raw = (data.data ?? {}) as Record<string, unknown>;
    const r = (raw.result ?? {}) as Record<string, unknown>;
    const finalizedAt = new Date().toISOString();

    let mapped: FinalizeResult = {
      activityId: Number(raw.activityId ?? activity.id),
      dryRun: !!dryRun,
      finalizedAt,
      milestones: [],
    };

    if (dryRun) {
      // ── Dry Run: build the rich preview from eligible[] + top10 + rewards_by_type.
      const eligible = Array.isArray(r.eligible) ? r.eligible : [];
      mapped.milestones = eligible.map((m) => {
        const obj = m as Record<string, unknown>;
        return {
          milestoneId: safeNum(obj.milestoneId),
          threshold:   safeNum(obj.threshold),
          rewardType:  (obj.rewardType === 'ENERGY' || obj.rewardType === 'MEDAL') ? obj.rewardType : 'ENERGY',
          rewardValue: typeof obj.rewardValue === 'string' ? obj.rewardValue : String(obj.rewardValue ?? ''),
          eligibleUsers: safeNum(obj.eligible),
          newlyClaimed:   0,
          dryRun:         true,
        } as FinalizeMilestoneSummary;
      });
      mapped.totalEligible           = safeNum(r.total_eligible);
      mapped.rewardsByType           = (r.rewards_by_type && typeof r.rewards_by_type === 'object')
                                        ? {
                                            energy_total: safeNum((r.rewards_by_type as Record<string, unknown>).energy_total),
                                            medal_total:  safeNum((r.rewards_by_type as Record<string, unknown>).medal_total),
                                          }
                                        : undefined;
      mapped.top10                   = Array.isArray(r.top10) ? (r.top10 as FinalizeTop10Entry[]) : [];
      mapped.activityEndTime         = typeof raw.activityEndTime === 'string' ? raw.activityEndTime : undefined;
      mapped.dryRunBypassedActivityEnd = raw.dryRunBypassedActivityEnd === true;
    } else {
      // ── Production path: production response only exposes distribution totals.
      // Build the milestone list from the activity's configured milestones.
      const sourceMilestones = activity.config?.milestones ?? [];
      mapped.milestones = sourceMilestones.map((m) => ({
        milestoneId: safeNum(m.id),
        threshold:   safeNum(m.threshold),
        rewardType:  m.rewardType,
        rewardValue: m.rewardType === 'ENERGY' ? String(m.energyValue ?? '') : String(m.medalId ?? ''),
        eligibleUsers: 0,
        newlyClaimed:   safeNum(r.distributed),
        dryRun:         false,
      }));
    }

    setSettlementResult(mapped);

    if (dryRun) {
      const totalEligible = mapped.totalEligible ?? 0;
      toast.success(`演练完成：${totalEligible} 个可结算资格`);
      setDryRunReportTarget({ activity, result: mapped, error: null });
    } else {
      const totalClaimed = (mapped.milestones ?? []).reduce((sum, item) => sum + (item.newlyClaimed ?? 0), 0);
      toast.success(`正式发奖完成：本次共发放 ${totalClaimed} 条奖励`);
      setFinalizeTarget(null);
    }
    } finally {
      setIsSubmittingSettlement(false);
    }
  };

  // ── REPARK 7.0 (2026-09-12): 指定补发 ────────────────────────────────────
  //   调 /api/admin/badge/grant-direct，复用 grantBadge()。
  //   不修改 milestone 逻辑，不删 badges 后台，不改 player reward-claim。
  const runDirectGrant = async () => {
    const identifier = directGrantIdentifier.trim();
    const badgeId    = directGrantBadgeId.trim();
    if (!identifier) {
      toast.error('请填写用户标识（UUID / 数字长 UID / 邮箱 / 昵称）');
      return;
    }
    if (!badgeId) {
      toast.error('请填写勋章 ID');
      return;
    }

    setIsSubmittingDirectGrant(true);
    setDirectGrantResult(null);
    try {
      const activeActivity = activities.find((act) => act.config?.isGlobalEnabled);
      const res = await adminFetch('/api/admin/badge/grant-direct', {
        method: 'POST',
        body: JSON.stringify({
          activityId:     activeActivity?.id,
          userIdentifier: identifier,
          badgeId,
        }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: { message: 'Invalid JSON' } }));

      if (data.ok) {
        const userInfo = data.data?.user ?? {};
        const badgeInfo = data.data?.badge ?? {};
        const summary = `补发成功：用户 ${userInfo.nickname ?? userInfo.uuid ?? identifier} → 勋章 ${badgeInfo.name ?? badgeId}`;
        setDirectGrantResult({ ok: true, summary, detail: `request_id=${data.data?.requestId ?? '-'}` });
        toast.success(summary);
      } else {
        const code    = data.error?.code ?? 'UNKNOWN';
        const message = data.error?.message ?? '补发失败';
        setDirectGrantResult({ ok: false, summary: `补发失败 (${code})`, detail: message });
        toast.error(`${code}: ${message}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '网络异常';
      setDirectGrantResult({ ok: false, summary: '补发失败：网络异常', detail: message });
      toast.error(message);
    } finally {
      setIsSubmittingDirectGrant(false);
    }
  };

  return (
    <div className="space-y-6">

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="admin-page-title">活动管理</h1>
          <p className="admin-page-desc">创建、编辑和管理所有活动配置</p>
        </div>
        <button
          onClick={openCreate}
          className="admin-btn admin-btn-primary"
        >
          <Plus size={14} strokeWidth={2.5} />
          新增活动
        </button>
      </div>

      {fetchError && (
        <div className="admin-alert admin-alert-error flex items-center gap-3">
          <AlertTriangle size={14} />
          <span>{fetchError}</span>
          <button onClick={fetchActivities} className="ml-auto text-red-400 hover:text-red-300 underline">
            重试
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-zinc-800 last:border-0 bg-[#121215]">
              <div className="w-12 h-3 bg-zinc-800 rounded animate-pulse" />
              <div className="w-32 h-3 bg-zinc-800 rounded animate-pulse" />
              <div className="w-20 h-3 bg-zinc-800 rounded animate-pulse ml-auto" />
              <div className="w-20 h-3 bg-zinc-800 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : activities.length === 0 ? (
        <div className="admin-card flex flex-col items-center gap-4 py-16">
          <div className="w-14 h-14 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
            <Plus size={24} className="text-zinc-600" />
          </div>
          <div className="text-center">
            <h3 className="text-zinc-200 text-sm font-medium mb-1">暂无活动</h3>
            <p className="text-zinc-500 text-xs">点击「新增活动」创建第一个活动</p>
          </div>
          <button onClick={openCreate} className="admin-btn admin-btn-primary">
            <Plus size={14} />
            新增活动
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="admin-table min-w-[960px]">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>活动名称</th>
                  <th>类型</th>
                  <th>开始时间</th>
                  <th>结束时间</th>
                  <th>状态</th>
                  <th>当前</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((act) => (
                  <tr key={act.id}>
                    <td><span className="font-mono text-xs text-zinc-500">{act.id}</span></td>
                    <td>
                      <span className="font-medium text-zinc-100 text-sm max-w-[200px] truncate block" title={act.name}>
                        {act.name}
                      </span>
                    </td>
                    <td>
                      <span className="admin-badge admin-badge-warning text-xs">
                        {act.type === 'LIVE2D' ? 'Spine 互动' : '消耗电量'}
                      </span>
                    </td>
                    <td><span className="font-mono text-xs text-zinc-400 whitespace-nowrap">{formatDate(act.start_time)}</span></td>
                    <td><span className="font-mono text-xs text-zinc-400 whitespace-nowrap">{formatDate(act.end_time)}</span></td>
                    <td>
                      <button
                        onClick={() => handleToggleStatus(act)}
                        className={`admin-badge cursor-pointer transition-colors ${
                          act.status === 'ENABLED' ? 'admin-badge-success hover:bg-zinc-800' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${act.status === 'ENABLED' ? 'bg-zinc-100' : 'bg-zinc-600'}`} />
                        {act.status === 'ENABLED' ? '已启用' : '已禁用'}
                      </button>
                    </td>
                    <td>
                      {act.config?.isGlobalEnabled ? (
                        <span className="admin-badge admin-badge-warning">
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-100 animate-pulse" />
                          当前
                        </span>
                      ) : (
                        <button
                          onClick={() => handleSetActive(act)}
                          className="text-xs text-zinc-500 hover:text-zinc-100 px-2 py-1 rounded-md hover:bg-zinc-800 transition-colors"
                          title="设为当前活动"
                        >
                          设为当前
                        </button>
                      )}
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(act)}
                          className="admin-btn-icon admin-btn-icon-success"
                          title={act.type === 'LIVE2D' ? '跳转至配置页' : '编辑活动'}
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(act)}
                          className="admin-btn-icon admin-btn-icon-danger"
                          title="删除"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(() => {
            const activeActivity = activities.find((act) => act.config?.isGlobalEnabled);
            if (!activeActivity) {
              return (
                <div className="admin-card">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={16} className="text-zinc-500 mt-0.5 shrink-0" />
                    <div>
                      <h3 className="text-sm font-medium text-zinc-100">奖励结算</h3>
                      <p className="mt-1 text-xs text-zinc-500">
                        当前没有被设为「当前活动」的活动，无法显示结算面板。
                      </p>
                    </div>
                  </div>
                </div>
              );
            }

            const settlementStatus = getActivitySettlementStatus(activeActivity.end_time);

            return (
              <div className="admin-card space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <ShieldAlert size={16} className="text-zinc-400" />
                      <h3 className="text-sm font-medium text-zinc-100">奖励结算</h3>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      仅针对当前活动「{activeActivity.name}」执行预演或正式发奖。
                    </p>
                  </div>
                  <span className="admin-badge admin-badge-warning self-start">
                    <span className={`h-1.5 w-1.5 rounded-full ${settlementStatus.ended ? 'bg-zinc-100' : 'bg-zinc-500'}`} />
                    {settlementStatus.label}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                    <div className="text-[11px] text-zinc-500 uppercase tracking-wider">活动 ID</div>
                    <div className="mt-1 font-mono text-base text-zinc-100">{activeActivity.id}</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                    <div className="text-[11px] text-zinc-500 uppercase tracking-wider">结束时间</div>
                    <div className="mt-1 text-sm text-zinc-100">{formatDate(activeActivity.end_time)}</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                    <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Milestone 数</div>
                    <div className="mt-1 text-base text-zinc-100">{activeActivity.config?.milestones?.length ?? 0}</div>
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-xs text-zinc-400">
                  Dry Run 只做资格预演，不落库。正式发奖会写入用户里程碑奖励记录并发放奖励，请谨慎操作。
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={() => runSettlement(activeActivity, true)}
                    disabled={isSubmittingSettlement}
                    className="admin-btn admin-btn-secondary"
                  >
                    {isSubmittingSettlement ? <RefreshCw size={13} className="animate-spin" /> : <PlayCircle size={13} />}
                    Dry Run 预演结算
                  </button>
                  <button
                    onClick={() => setFinalizeTarget(activeActivity)}
                    disabled={isSubmittingSettlement}
                    className="admin-btn admin-btn-danger"
                  >
                    {isSubmittingSettlement ? <RefreshCw size={13} className="animate-spin" /> : <Rocket size={13} />}
                    正式发奖
                  </button>
                  <button
                    onClick={() => {
                      setShowDirectGrant((v) => !v);
                      setDirectGrantResult(null);
                    }}
                    disabled={isSubmittingSettlement}
                    className="admin-btn admin-btn-primary"
                  >
                    <Send size={13} />
                    指定补发
                  </button>
                </div>

                {/* REPARK 7.0 (2026-09-12): 指定补发面板 — 复用 grantBadge() */}
                {showDirectGrant && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 space-y-3">
                    <div className="text-xs text-zinc-400">
                      将指定勋章发给指定用户。复用现有 <code className="text-emerald-400">grantBadge()</code>，仍走 Main Station，幂等（同一用户+勋章+活动 24h 内不重复发）。
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1">
                          活动 ID（默认当前活动）
                        </label>
                        <input
                          type="text"
                          readOnly
                          value={activeActivity.id}
                          className="admin-input font-mono text-xs bg-zinc-900 cursor-not-allowed"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1">
                          勋章 ID <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          placeholder="例：1 / 2 / 10021"
                          value={directGrantBadgeId}
                          onChange={(e) => setDirectGrantBadgeId(e.target.value)}
                          className="admin-input font-mono text-xs"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1">
                          用户标识 <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          placeholder="UUID / 数字长 UID / 邮箱 / 昵称（精确匹配）"
                          value={directGrantIdentifier}
                          onChange={(e) => setDirectGrantIdentifier(e.target.value)}
                          className="admin-input text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={runDirectGrant}
                        disabled={isSubmittingDirectGrant || !directGrantIdentifier.trim() || !directGrantBadgeId.trim()}
                        className="admin-btn admin-btn-primary"
                      >
                        {isSubmittingDirectGrant ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
                        补发
                      </button>
                      <button
                        onClick={() => {
                          setShowDirectGrant(false);
                          setDirectGrantResult(null);
                          setDirectGrantIdentifier('');
                          setDirectGrantBadgeId('');
                        }}
                        disabled={isSubmittingDirectGrant}
                        className="admin-btn admin-btn-secondary"
                      >
                        收起
                      </button>
                    </div>
                    {directGrantResult && (
                      <div
                        className={`rounded-lg border px-3 py-2 text-xs ${
                          directGrantResult.ok
                            ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-200'
                            : 'border-red-700/50 bg-red-950/30 text-red-200'
                        }`}
                      >
                        <div className="font-medium">{directGrantResult.summary}</div>
                        {directGrantResult.detail && (
                          <div className="mt-0.5 font-mono text-[11px] opacity-80 break-all">
                            {directGrantResult.detail}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {settlementResult && (
                  <div className="overflow-hidden rounded-lg border border-zinc-800">
                    <div className="border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
                      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                        <h4 className="text-sm font-medium text-zinc-100">结算结果摘要</h4>
                        <span className="text-xs text-zinc-500">
                          模式：{settlementResult.dryRun ? 'Dry Run 预演' : '正式发奖'} · {new Date(settlementResult.finalizedAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Milestone</th>
                            <th>阈值</th>
                            <th>奖励类型</th>
                            <th>奖励值</th>
                            <th>Eligible</th>
                            <th>Distributed</th>
                          </tr>
                        </thead>
                        <tbody>
                          {settlementResult.milestones.map((item) => (
                            <tr key={`${item.milestoneId}-${item.threshold}`}>
                              <td className="font-mono">{item.milestoneId}</td>
                              <td className="font-mono">{item.threshold.toLocaleString()}</td>
                              <td>{item.rewardType}</td>
                              <td>{item.rewardValue}</td>
                              <td className="text-zinc-100">{item.eligibleUsers}</td>
                              <td className="text-zinc-100">{item.newlyClaimed}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {deleteTarget && (
        <DeleteDialog
          activity={deleteTarget}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          isDeleting={isDeleting}
        />
      )}

      {finalizeTarget && (
        <FinalizeConfirmDialog
          activity={finalizeTarget}
          isSubmitting={isSubmittingSettlement}
          onCancel={() => setFinalizeTarget(null)}
          onConfirm={() => runSettlement(finalizeTarget, false)}
        />
      )}

      {showModal && (
        <ActivityModal
          editing={editing}
          form={form}
          nameLen={form.name.length}
          onField={handleField}
          onSave={handleSave}
          onClose={() => { setShowModal(false); resetForm(); }}
          isSaving={isSaving}
        />
      )}

      {dryRunReportTarget && (
        <DryRunReportModal
          activity={dryRunReportTarget.activity}
          result={dryRunReportTarget.result}
          onClose={() => setDryRunReportTarget(null)}
        />
      )}
    </div>
  );
}
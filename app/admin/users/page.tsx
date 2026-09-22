'use client';

import { useState, useCallback, useEffect } from 'react';
import { adminFetch } from '@/app/admin/lib/adminApi';
import {
  Search, TrendingUp, Zap, Gem, Award, Medal,
  RefreshCw, Lock, Unlock,
  AlertTriangle, ShieldAlert, ChevronLeft, Copy, Check,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── Copy button ───────────────────────────────────────────────────────────────
async function copyToClipboard(text: string): Promise<void> {
  // Step 1: Modern Clipboard API
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      // Clipboard API failed — fall through to execCommand fallback
    }
  }

  // Step 2: execCommand fallback
  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) {
        resolve();
      } else {
        reject(new Error('execCommand returned false'));
      }
    } catch (err) {
      document.body.removeChild(textarea);
      reject(err);
    }
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (copied) return;
    try {
      await copyToClipboard(text);
      setCopied(true);
      toast.success('已复制用户ID');
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('[CopyButton] copy failed:', err);
      toast.error('复制失败，请手动复制');
    }
  };

  return (
    <button onClick={handleCopy} title="复制 UUID" className="inline-flex items-center gap-1 text-[10px] ml-1 px-1 py-0.5 rounded transition-colors cursor-pointer" style={{ color: copied ? '#238636' : '#484f58', background: copied ? 'rgba(35,134,54,0.1)' : 'rgba(255,255,255,0.03)' }}>
      {copied ? <Check size={10} /> : <Copy size={10} />}
    </button>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface UserProfile {
  id: string;
  uid: string | null;   // human-readable short ID (e.g. "128")
  nickname: string;
  email: string;
  avatar: string;
  createdAt: string | null;
}

interface InventorySnapshot {
  propA: number;
  propB: number;
  totalDamage: number;
  updatedAt: string | null;
}

interface ActivityInfo {
  id: number;
  name: string;
  type: string;
  startTime: string;
  endTime: string;
  status: string;
  totalDamage: number;
  milestones?: MilestoneDef[];
  // REPARK 7.0 (2026-09-18) ISSUE 2: server-authoritative flag from
  // /api/admin/users/search. When false, the entire 道具数量管理 block
  // is hidden — we deliberately do NOT fall back to getActiveActivity(),
  // because the admin panel tracks the operator's per-activity selection.
  // Optional so legacy consumers (and SSR snapshots) stay type-safe.
  hasItems?: boolean;
}

interface MilestoneClaim {
  is_claimed: boolean;
  is_locked: boolean;
  claimed_at: string | null;
  // REPARK 7.0 (2026-09-14): Admin special-unlock flag.
  admin_bypass?: boolean;
  admin_bypass_source?: string | null;
}

interface SearchResult {
  user: UserProfile;
  inventory: InventorySnapshot;
  activities: ActivityInfo[];
  // P0 2026-08-30 (Batch D1, collateral fix): inner keys are stored as
  // strings at runtime (JS object keys are always strings), and the panel
  // indexes them via String(ms.id)/String(ms.threshold). Using
  // Record<string, MilestoneClaim> keeps the type aligned with the actual
  // shape returned by /api/admin/users/search (read from milestone_rewards).
  milestoneClaims: Record<string, Record<string, MilestoneClaim>>;
}

interface UserListItem {
  id: string;
  uid: string | null;   // human-readable short ID (e.g. "128")
  nickname: string;
  email: string;
  avatar: string;
  createdAt: string | null;
  inventory: { propA: number; propB: number; totalDamage: number };
  lastLogin: string | null;
}

interface MilestoneDef {
  // REPARK 7.0 (2026-09-15 round 2):
  //   `id`         = literal display id from activity config (e.g. "m1789424352" or 75)
  //   `idNumeric`  = digit-only form, used for matching milestone_rewards rows
  //                  whose milestone_id is INTEGER (per aws_01_schema.sql).
  id: number | string;
  idNumeric?: number | null;
  threshold: number;
  rewardType: string;
  energyValue?: number;
  medalId?: string;
  // REPARK 7.0 (2026-09-14): optional real badge name from badge catalog.
  // Present when attachBadgeNames was applied (MEDAL milestones only).
  badgeName?: string | null;
  // REPARK 7.0 (2026-09-21) ADMIN MEDAL CARD POLISH V2: optional badge
  // description from the Main Station /api/battle/init response. Same
  // null semantics as `badgeName`. Empty strings are pre-normalised to
  // null by the cache layer so callers can treat "missing" uniformly.
  badgeDescription?: string | null;
}

// ── Reason Modal ───────────────────────────────────────────────────────────────

interface ReasonModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor?: string;
  // REPARK 7.0 (2026-09-15 round 5 hotfix): onConfirm returns a Promise.
  // ReasonModal awaits it, manages its own loading + error state, and only
  // closes itself on success. On failure the modal stays open and surfaces
  // the error so the user can fix the reason / retry without re-typing.
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

function ReasonModal({ title, message, confirmLabel, confirmColor = '#2B7DE9', onConfirm, onCancel, loading }: ReasonModalProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Combined busy flag (external `loading` prop OR internal in-flight click).
  const busy = Boolean(loading) || submitting;
  const reasonEmpty = !reason.trim();
  const canSubmit = !busy && !reasonEmpty;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(reason);
      // On success the parent closes the modal via setReasonModal(null).
      // Don't reset reason here — the component is about to unmount.
    } catch (e) {
      // Surface error inline; keep modal open so the user can edit the
      // reason and retry. ReasonModal owns this state so the user never
      // loses what they typed.
      setError(e instanceof Error ? e.message : '操作失败，请稍后重试');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        // REPARK 7.0 (2026-09-15 round 5 hotfix): clicking the overlay cancels
        // ONLY when no submission is in flight. This prevents accidental
        // dismissal mid-request and avoids the user thinking their action
        // succeeded when it actually errored.
        onClick={() => { if (!busy) onCancel(); }}
      />
      <div
        className="relative bg-[#161b22] rounded-2xl border border-[#30363d] shadow-2xl p-6 w-full max-w-sm mx-4"
        style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.8)' }}
        // Block click-through from the backdrop while submitting.
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-white mb-2 text-center">{title}</h3>
        <p className="text-sm text-[#8b949e] text-center mb-4">{message}</p>
        <div className="flex items-start gap-2 p-2.5 rounded-lg mb-4" style={{ background: '#FFF8E1', border: '1px solid #FFE082' }}>
          <AlertTriangle size={13} style={{ color: '#F57F17' }} className="mt-0.5 shrink-0" />
          <p className="text-[11px]" style={{ color: '#F57F17', lineHeight: 1.5 }}>此操作将修改用户数据，所有变更记录操作日志。</p>
        </div>
        <textarea
          value={reason}
          onChange={(e) => { setReason(e.target.value); if (error) setError(null); }}
          placeholder="请输入操作原因（必填）"
          rows={3}
          className="admin-input !resize-none mb-1 w-full"
          autoFocus
          disabled={busy}
        />
        {/* Inline validation hint when the textarea is empty but the user has
            interacted with the modal. Keeps the disabled button from being a
            silent mystery. */}
        {reasonEmpty && (
          <p className="text-[11px] text-[#F57F17] mb-3">请先填写操作原因，确认按钮才会启用。</p>
        )}
        {!reasonEmpty && !error && <div className="mb-3" />}
        {error && (
          <p className="text-[11px] text-red-400 mb-3 flex items-start gap-1.5">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}
        <div className="flex gap-3">
          <button
            onClick={() => { if (!busy) onCancel(); }}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-[#8b949e] border border-[#30363d] hover:text-white hover:border-[#484f58] transition-all disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canSubmit}
            // REPARK 7.0 (2026-09-15 round 5 hotfix): explicit cursor-pointer
            // for the enabled state, cursor-not-allowed for the disabled
            // state. Tailwind defaults only set cursor-pointer on interactive
            // elements that aren't buttons-with-disabled; the inline style
            // guarantees the affordance even when the prop classes are
            // shadowed by global CSS.
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all ${
              canSubmit
                ? 'cursor-pointer hover:brightness-110'
                : 'cursor-not-allowed disabled:opacity-50'
            }`}
            style={{ background: confirmColor }}
            title={reasonEmpty ? '请先填写操作原因' : ''}
          >
            {busy ? <span className="flex items-center justify-center gap-2"><RefreshCw size={12} className="animate-spin" />解锁中…</span> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Prop Card (two-step edit) ─────────────────────────────────────────────────

interface PropCardProps {
  label: string;
  propKey: 'propA' | 'propB';
  value: number;
  color: string;
  icon: React.ReactNode;
  onSave: (propType: 'prop_a' | 'prop_b', newCount: number, reason: string) => Promise<void>;
  activityId: number;
  disabled?: boolean;
}

function PropCard({ label, propKey, value, color, icon, onSave, activityId, disabled }: PropCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEnter = () => { if (disabled) return; setDraft(String(value)); setEditing(true); };
  const handleCancel = () => { setDraft(String(value)); setEditing(false); setError(null); };

  const handleSave = async (reason: string) => {
    const n = parseInt(draft, 10);
    if (isNaN(n) || n < 0) { setError('数量必须 ≥ 0'); return; }
    setSaving(true);
    setError(null);
    try { await onSave(propKey === 'propA' ? 'prop_a' : 'prop_b', n, reason); setEditing(false); }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    finally { setSaving(false); }
  };

  return (
    <div className="rounded-xl border p-4 transition-all" style={{ background: disabled || saving ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)', borderColor: editing ? color : 'rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}20` }}>{icon}</div>
        <span className="text-xs font-medium" style={{ color: '#8b949e' }}>{label}</span>
      </div>
      {editing ? (
        <>
          <input type="number" min={0} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus className="admin-input !py-2 !px-3 w-full mb-2" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '24px', fontWeight: 700, color }} />
          {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleCancel} disabled={saving} className="flex-1 py-1.5 rounded-lg text-xs font-medium text-[#8b949e] border border-[#30363d] hover:text-white hover:border-[#484f58] transition-all disabled:opacity-50">取消</button>
            <button onClick={() => handleSave('')} disabled={saving} className="flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50" style={{ background: `${color}30`, borderColor: `${color}60`, color }}>{saving ? <RefreshCw size={11} className="animate-spin mx-auto" /> : '下一步'}</button>
          </div>
        </>
      ) : (
        <button onClick={handleEnter} disabled={disabled} className="w-full text-left">
          <div className="font-mono font-black mb-0.5" style={{ fontSize: '32px', fontWeight: 900, color: disabled ? '#484f58' : color, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.1 }}>{value.toLocaleString()}</div>
          <div className="text-[10px]" style={{ color: disabled ? '#484f58' : `${color}80` }}>点击修改</div>
        </button>
      )}
    </div>
  );
}

// ── Milestone Row ──────────────────────────────────────────────────────────────

type MSState = 'completed' | 'pending' | 'locked' | 'unmet' | 'bypassed';

function getMSState(threshold: number, damage: number, claim?: MilestoneClaim): MSState {
  if (claim?.is_locked) return 'locked';
  if (claim?.is_claimed) return 'completed';
  // REPARK 7.0 (2026-09-14): admin_bypass distinguishes "special unlock" from
  // "ordinary pending". The row is set to bypassed only when admin_bypass is
  // TRUE; ordinary unlocked-and-unclaimed rows remain 'unmet' or 'pending'.
  if (claim?.admin_bypass) return 'bypassed';
  if (damage >= threshold) return 'pending';
  return 'unmet';
}

const STATE_STYLES: Record<MSState, { badgeBg: string; badgeColor: string; label: string }> = {
  completed: { badgeBg: 'rgba(35,134,54,0.2)',   badgeColor: '#238636', label: '已领取' },
  pending:  { badgeBg: 'rgba(255,183,71,0.15)', badgeColor: '#FFB347', label: '待领取' },
  locked:   { badgeBg: 'rgba(72,79,88,0.2)',    badgeColor: '#8b949e', label: '已锁定' },
  unmet:    { badgeBg: 'rgba(255,183,71,0.08)', badgeColor: '#484f58', label: '未达标' },
  bypassed: { badgeBg: 'rgba(99,99,255,0.15)',  badgeColor: '#6363FF', label: '已特殊解锁' },
};

/**
 * Reward badge: presentation per reward type.
 * ENERGY  → icon + "x 电量" line, yellow/gold (unchanged behavior).
 * MEDAL   → compact green card mirroring the activity admin badge-preview
 *           style (bg-emerald-500/10 border-emerald-500/25 text-emerald-400).
 *           Reads ONLY the existing MilestoneDef fields
 *           (badgeName, badgeDescription, medalId) — no new lookups,
 *           no schema changes, no binding changes.
 *
 * REPARK 7.0 (2026-09-21) ADMIN MEDAL CARD POLISH V2: a 2-line description
 * is rendered below the badge name when `badgeDescription` is non-empty.
 * The text is muted emerald, line-clamped to 2 lines, and omitted
 * entirely when no description is available — matching the 活动管理
 * /admin/badges card behaviour where empty descriptions are skipped
 * rather than rendered as a placeholder.
 */
function RewardBadge({ ms }: { ms: MilestoneDef }) {
  const isEnergy = ms.rewardType === 'ENERGY';
  const energyLabel = `${ms.energyValue ?? 0} 电量`;
  const medalName = ms.badgeName ?? (ms.medalId ? `勋章（ID：${ms.medalId}）` : '勋章');
  // Treat empty strings as missing so the description line is never rendered
  // for a literal "". The cache layer already normalises empty strings to
  // null; this guard catches any legacy milestone that bypassed the cache.
  const medalDescription =
    typeof ms.badgeDescription === 'string' && ms.badgeDescription.trim().length > 0
      ? ms.badgeDescription
      : null;

  if (isEnergy) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="flex-shrink-0 flex items-center justify-center rounded-lg w-8 h-8"
          style={{ background: 'rgba(255,208,96,0.12)' }}
        >
          <Zap size={16} style={{ color: '#FFD060' }} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium leading-tight truncate" style={{ color: '#FFD060' }}>
            {energyLabel}
          </div>
          <div className="text-[10px] text-[#484f58] leading-tight">ENERGY</div>
        </div>
      </div>
    );
  }

  // MEDAL — compact green card (compact variant of activity-admin preview).
  return (
    <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 min-w-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <Award size={12} className="text-emerald-400 shrink-0" aria-hidden="true" />
        <p className="text-xs font-semibold text-emerald-400 truncate">{medalName}</p>
      </div>
      {medalDescription && (
        <p className="text-[10px] text-emerald-500/55 leading-snug mt-0.5 line-clamp-2">
          {medalDescription}
        </p>
      )}
      {ms.medalId && (
        <p className="text-[10px] text-emerald-500/50 font-mono mt-0.5">ID {ms.medalId}</p>
      )}
    </div>
  );
}

function MilestoneRow({ ms, claim, damage, onUnlock, onLock }: { ms: MilestoneDef; claim?: MilestoneClaim; damage: number; onUnlock: (m: MilestoneDef) => void; onLock: (m: MilestoneDef) => void }) {
  const state = getMSState(ms.threshold, damage, claim);
  const s = STATE_STYLES[state];

  // Button visibility per business state:
  //   completed  → no action (already claimed; server ALREADY_CLAIMED guard)
  //   unmet     → unlock only (player hasn't reached threshold yet)
  //   pending   → lock only (reached threshold, can claim; lock prevents claim)
  //   locked    → unlock only (admin explicitly blocked it; admin can re-enable)
  //   bypassed  → lock only (admin already bypassed; can lock back)
  const showUnlock = state === 'unmet' || state === 'locked';
  const showLock   = state === 'pending' || state === 'bypassed';
  const showAction = showUnlock || showLock;

  return (
    <tr>
      {/* Threshold: large number + small label */}
      <td className="px-4 py-3 align-middle">
        <div className="font-mono text-sm font-semibold text-white leading-tight">
          {ms.threshold.toLocaleString()}
        </div>
        <div className="text-[10px] text-[#484f58] leading-tight mt-0.5">伤害</div>
      </td>

      {/* Reward: icon + label */}
      <td className="px-4 py-3 align-middle">
        <RewardBadge ms={ms} />
      </td>

      {/* Status: badge */}
      <td className="px-4 py-3 align-middle">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ background: s.badgeBg, color: s.badgeColor }}
        >
          {s.label}
        </span>
      </td>

      {/* Action — presentation-only unification.
          All three branches share identical box dimensions (min-w-[96px] h-7,
          px-3, rounded-lg, text-xs font-semibold) so the action column reads
          as a single column of same-size cells. Business bindings are NOT
          changed: 已结算 is a span with no onClick / no API call. */}
      <td className="px-4 py-3 text-right align-middle">
        {!showAction ? (
          <span
            className="inline-flex items-center justify-center min-w-[96px] h-7 px-3 rounded-lg text-xs font-semibold border border-[#30363d]/50 bg-[#30363d]/30 text-[#8b949e] select-none pointer-events-none whitespace-nowrap"
            aria-disabled="true"
          >
            已结算
          </span>
        ) : showUnlock ? (
          <button
            type="button"
            onClick={() => onUnlock(ms)}
            style={{ cursor: 'pointer' }}
            title="特殊解锁该档位，玩家可在未达标时领取（不调用 Grant）"
            className="inline-flex items-center justify-center gap-1.5 min-w-[96px] h-7 px-3 rounded-lg text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/50 transition-all whitespace-nowrap"
          >
            <Unlock size={11} />手动解锁
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onLock(ms)}
            style={{ cursor: 'pointer' }}
            title="锁定该档位，玩家不可领取"
            className="inline-flex items-center justify-center gap-1.5 min-w-[96px] h-7 px-3 rounded-lg text-xs font-semibold bg-[#30363d]/30 hover:bg-[#30363d]/50 text-[#8b949e] border border-[#30363d]/50 hover:border-[#484f58] transition-all whitespace-nowrap"
          >
            <Lock size={11} />锁定奖励
          </button>
        )}
      </td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  // ── User list (default view) ───────────────────────────────────────────
  const [userList, setUserList] = useState<UserListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listPage, setListPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const LIST_PAGE_SIZE = 30;

  // ── Search state ──────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ── Selected user detail ─────────────────────────────────────────────────
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<number | null>(null);

  // ── Reason modal ────────────────────────────────────────────────────────
  const [reasonModal, setReasonModal] = useState<{
    title: string; message: string; confirmLabel: string; confirmColor: string;
    milestone?: MilestoneDef; action?: 'unlock' | 'lock';
  } | null>(null);

  // ── Load user list ──────────────────────────────────────────────────────
  // BUG-103 (2026-09-16): clearing the search-result / activity selection
  // state on *request initiation* (not on success) gives the admin
  // immediate visual feedback that the detail view is being exited. Failure
  // (network / API error) remains visible via the existing listError banner;
  // on retry the same click path will re-attempt and re-load.
  const loadUserList = useCallback(async (q: string = '', page: number = 1) => {
    setListLoading(true);
    setListError(null);
    // Exit detail panel first so the list table becomes visible immediately.
    // This is intentionally placed BEFORE the await so that the user's click
    // already produces a visible state transition; the network call is async.
    setSearchResult(null);
    setSelectedActivityId(null);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(LIST_PAGE_SIZE) });
      if (q) params.set('q', q);
      const res = await adminFetch(`/api/admin/users/list?${params}`);
      const data = await res.json();
      if (data.ok) {
        setUserList(data.data.users);
        setListTotal(data.data.pagination.total);
        setListPage(page);
      } else {
        setListError(data.error?.message ?? '加载失败');
      }
    } catch { setListError('网络错误'); }
    finally { setListLoading(false); }
  }, []);

  useEffect(() => { loadUserList('', 1); }, [loadUserList]);

  // ── Load user detail ───────────────────────────────────────────────────
  const fetchUserDetail = useCallback(async (uid: string) => {
    setSearchLoading(true);
    setSearchError(null);
    setSearchResult(null);
    setSelectedActivityId(null);
    try {
      const res = await adminFetch(`/api/admin/users/search?query=${encodeURIComponent(uid)}`);
      const data = await res.json();
      if (data.ok) {
        setSearchResult(data.data);
        if (data.data.activities.length > 0) setSelectedActivityId(data.data.activities[0].id);
      } else {
        setSearchError(data.error?.message ?? '用户不存在');
      }
    } catch { setSearchError('网络错误'); }
    finally { setSearchLoading(false); }
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    await fetchUserDetail(q);
  }, [query, fetchUserDetail]);

  const handleSelectUser = useCallback(async (user: UserListItem) => {
    setQuery(user.id);
    await fetchUserDetail(user.id);
  }, [fetchUserDetail]);

  const handleBackToList = useCallback(() => {
    setSearchResult(null);
    setQuery('');
    setSelectedActivityId(null);
    setSearchError(null);
  }, []);

  // P0 2026-08-30: Reset — clears search query and reloads the full user list.
  // Distinct from handleBackToList (which returns from detail panel) — reset is
  // a single action that returns the page to the pristine list view without
  // any active search or filter.
  const handleReset = useCallback(async () => {
    setQuery('');
    setSearchError(null);
    setSearchResult(null);
    setSelectedActivityId(null);
    await loadUserList('', 1);
  }, [loadUserList]);

  const handleInventorySave = async (propType: 'prop_a' | 'prop_b', newCount: number, reason: string) => {
    if (!searchResult) return;
    const activityId = selectedActivityId ?? searchResult.activities[0]?.id ?? 0;
    const res = await adminFetch(`/api/admin/users/${encodeURIComponent(searchResult.user.id)}/inventory/adjust`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activityId, propType, newCount, reason }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error?.message ?? '保存失败');
    setSearchResult((prev) => prev ? { ...prev, inventory: { ...prev.inventory, [propType === 'prop_a' ? 'propA' : 'propB']: newCount } } : prev);
  };

  const handleMilestoneAction = async (action: 'unlock' | 'lock', ms: MilestoneDef, reason: string) => {
    if (!searchResult) return;
    // NOTE: milestone_rewards has no activity_id column, so override is
    // per-user, per-milestone globally. milestoneId alone is sent to the API.
    const res = await adminFetch(`/api/admin/users/${encodeURIComponent(searchResult.user.id)}/milestones/override`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestoneId: ms.id, action, reason }),
    });
    const data = await res.json();
    if (!data.ok) {
      // Backend already returns structured error messages (e.g.
      // ALREADY_CLAIMED, MIGRATION_REQUIRED, VALIDATION_ERROR). Surface them
      // directly so the admin knows why the action was rejected.
      const apiMsg = data?.error?.message;
      const errMsg = apiMsg
        ? `操作失败：${apiMsg}`
        : '操作失败，请稍后重试';
      throw new Error(errMsg);
    }
    setSearchResult((prev) => {
      if (!prev) return prev;
      const aid = String(selectedActivityId ?? prev.activities[0]?.id ?? 0);
      // Use server-authoritative response data. Don't synthesize claim state
      // client-side — the server knows the actual current row.
      const next: any = {
        is_claimed: Boolean(data.data?.is_claimed),
        is_locked:  Boolean(data.data?.is_locked),
        claimed_at: data.data?.claimed_at ?? null,
        admin_bypass: Boolean(data.data?.admin_bypass ?? false),
        admin_bypass_source: data.data?.admin_bypass_source ?? null,
      };
      return {
        ...prev,
        milestoneClaims: {
          ...prev.milestoneClaims,
          [aid]: {
            ...(prev.milestoneClaims[aid] ?? {}),
            [String(ms.id)]: next,
          },
        },
      };
    });
  };

  const rewardLabel = (ms: MilestoneDef) => {
    if (ms.rewardType === 'ENERGY') return `${ms.energyValue ?? 0} 电量`;
    if (ms.badgeName && ms.badgeName.length > 0) return `勋章：${ms.badgeName}`;
    if (ms.medalId) return `勋章（ID：${ms.medalId}）`;
    return '勋章';
  };

  const handleUnlock = (ms: MilestoneDef) => setReasonModal({ title: '手动解锁奖励', message: `确定要解锁奖励「${rewardLabel(ms)}」（伤害阈值 ${ms.threshold.toLocaleString()}）吗？`, confirmLabel: '确认解锁', confirmColor: '#238636', milestone: ms, action: 'unlock' });
  const handleLock = (ms: MilestoneDef) => setReasonModal({ title: '锁定奖励', message: `确定要锁定奖励「${rewardLabel(ms)}」（伤害阈值 ${ms.threshold.toLocaleString()}）吗？`, confirmLabel: '确认锁定', confirmColor: '#f85149', milestone: ms, action: 'lock' });

  const handleReasonConfirm = async (reason: string): Promise<void> => {
    // REPARK 7.0 (2026-09-15 round 5 hotfix): ReasonModal now owns the
    // loading/error UI and only closes itself on success. We must NOT
    // call setReasonModal(null) here — that would hide errors from the
    // user. Propagate failures by throwing; the modal catches and shows.
    if (!reason.trim()) {
      throw new Error('请填写操作原因');
    }
    if (reasonModal?.milestone && reasonModal?.action) {
      await handleMilestoneAction(reasonModal.action, reasonModal.milestone, reason);
      // Close modal only after the action succeeded (handleMilestoneAction
      // throws on failure, so the modal stays open with the error visible).
      setReasonModal(null);
    } else {
      throw new Error('无效的操作');
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────
  const selectedActivity = searchResult?.activities.find((a) => a.id === selectedActivityId);
  const selectedDamage = selectedActivity?.totalDamage ?? 0;

  const totalPages = Math.ceil(listTotal / LIST_PAGE_SIZE);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">

      {/* ── Header (no icon) ── */}
      <div className="admin-page-header shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="admin-page-title">用户活动数据管理</h1>
            <p className="admin-page-desc">按 UID 或 UUID 查询用户，修改道具与里程碑奖励</p>
          </div>
        </div>
      </div>

      {/* ── Sticky Search / Filter Bar (Batch A) ── */}
      {/* Consolidated: one sticky primary control with a secondary exact-lookup action.
          - 筛选   → filters the user list (does NOT auto-open detail)
          - 查找用户 → exact lookup by UID/email → opens detail (preserves previous top-bar behavior)
          The bar sticks at the top of the .admin-main scroll container. */}
      <div className="admin-sticky-search shrink-0 px-6 pt-3 pb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-md min-w-[260px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#484f58' }} />
            <input type="text" className="admin-input !pl-9 !pr-4 !py-2 w-full"
              placeholder="输入 UID 或 UUID 搜索…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !query.trim()) return;
                // Batch A follow-up: Enter on primary search input now mirrors
                // the 筛选 button — filters the user list and does NOT auto-open
                // the detail panel. Use 查找用户 button (or click a row) for the
                // exact-lookup → auto-detail flow.
                e.preventDefault();
                loadUserList(query.trim(), 1);
              }}
            />
          </div>
          <button onClick={() => { if (query.trim()) loadUserList(query.trim(), 1); }}
            disabled={listLoading || !query.trim()}
            className="admin-btn admin-btn-primary"
            title="按 UID / UUID / 邮箱 模糊匹配，可返回多个用户">
            {listLoading ? <><RefreshCw size={13} className="animate-spin" />加载中…</> : <><Search size={13} />模糊筛选</>}
          </button>
          <button onClick={handleSearch}
            disabled={searchLoading || !query.trim()}
            className="admin-btn admin-btn-secondary"
            title="按 UID / UUID / 邮箱 精确匹配，并直接打开单个用户详情（建议输入完整关键词）">
            {searchLoading ? <><RefreshCw size={13} className="animate-spin" />查找中…</> : <><Search size={13} />查找用户</>}
          </button>
          {/* P0 2026-08-30: Reset button — clears query and returns to full paginated list. */}
          {(query.trim() || searchResult) && (
            <button onClick={handleReset}
              disabled={listLoading}
              className="admin-btn admin-btn-secondary"
              title="清空搜索并返回完整列表">
              <RefreshCw size={13} />重置
            </button>
          )}
          {searchResult && (
            <button onClick={handleBackToList} className="admin-btn admin-btn-secondary">
              <ChevronLeft size={13} />返回列表
            </button>
          )}
          {!searchResult && listTotal > 0 && query && (
            <span className="text-xs" style={{ color: '#8b949e' }}>共 {listTotal} 个结果</span>
          )}
        </div>
        {/* #82 (2026-08-31) UX clarification: explain 模糊筛选 vs 查找用户.
            - 模糊筛选: matches UID / UUID / email fragments, returns zero-to-many rows.
            - 查找用户: exact-match resolver, opens a single detail panel.
            Keep the wording operator-facing; no internal terminology.
            REPARK 7.0 (2026-09-16): nickname hidden per customer request — UI no longer
            treats nickname as a primary identifier (UID / UUID only). Internal nickname
            search SQL is preserved but no longer surfaced in operator-facing copy. */}
        <p className="mt-2 text-[11px]" style={{ color: '#6e7681', lineHeight: 1.5 }}>
          模糊筛选按 UID / UUID / 邮箱 模糊匹配，可列出多个用户；查找用户用于精确匹配并直接打开单个用户详情，建议输入完整 UID / UUID / 邮箱。
        </p>
        {(searchError || listError) && (
          <div className="flex items-center gap-2 mt-3 px-3 py-2.5 rounded-lg" style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)' }}>
            <AlertTriangle size={13} className="text-red-400 shrink-0" />
            <span className="text-xs text-red-300">{searchError ?? listError}</span>
            <button onClick={() => { setSearchError(null); setListError(null); }} className="ml-auto text-red-400 hover:text-red-300 text-xs">关闭</button>
          </div>
        )}
      </div>

      {/* ── Main Content ── */}
      {searchResult ? (
        <UserDetailPanel
          searchResult={searchResult}
          selectedActivity={selectedActivity}
          selectedActivityId={selectedActivityId}
          setSelectedActivityId={setSelectedActivityId}
          selectedDamage={selectedDamage}
          onInventorySave={handleInventorySave}
          onUnlock={handleUnlock}
          onLock={handleLock}
          listLoading={searchLoading}
        />
      ) : (
        <UserListPanel
          users={userList}
          loading={listLoading}
          onSelectUser={handleSelectUser}
          onSearch={async (q) => { await loadUserList(q, 1); }}
          page={listPage}
          total={listTotal}
          pageSize={LIST_PAGE_SIZE}
          totalPages={totalPages}
          onPageChange={(p) => loadUserList(query.trim(), p)}
          query={query}
          setQuery={setQuery}
        />
      )}

      {reasonModal && (
        <ReasonModal
          title={reasonModal.title}
          message={reasonModal.message}
          confirmLabel={reasonModal.confirmLabel}
          confirmColor={reasonModal.confirmColor}
          onConfirm={handleReasonConfirm}
          onCancel={() => setReasonModal(null)}
        />
      )}
    </div>
  );
}

// ── User List Panel ──────────────────────────────────────────────────────────

function UserListPanel({ users, loading, onSelectUser, onSearch, page, total, pageSize, totalPages, onPageChange, query, setQuery }: {
  users: UserListItem[]; loading: boolean; onSelectUser: (u: UserListItem) => void;
  onSearch: (q: string) => void; page: number; total: number; pageSize: number; totalPages: number;
  onPageChange: (p: number) => void; query: string; setQuery: (q: string) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Inline filter removed in Batch A: consolidated into the page-level
          sticky search/filter bar above. The list now reads from the parent-
          level query state and only renders the table / loading / empty states. */}

      {loading ? (
        <div className="admin-card flex items-center justify-center py-16">
          <RefreshCw size={20} className="animate-spin" style={{ color: '#484f58' }} />
          <span className="ml-3 text-sm" style={{ color: '#484f58' }}>加载中…</span>
        </div>
      ) : users.length === 0 ? (
        <div className="admin-card flex flex-col items-center py-16">
          <Search size={28} style={{ color: '#30363d' }} />
          <p className="mt-3 text-sm" style={{ color: '#484f58' }}>{query ? '未找到相关用户，请尝试其他关键词' : '暂无用户'}</p>
        </div>
      ) : (
        <div className="admin-card !p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>闪电符文</th>
                  <th>潮汐晶石</th>
                  <th>玩家总伤害（全局）</th>
                  <th>注册时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="cursor-pointer hover:bg-white/3 transition-colors">
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ background: 'rgba(255,255,255,0.04)' }}>{u.avatar}</div>
                        <div className="min-w-0">
                          {/* UID: prominent (primary identifier) */}
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-xs" style={{ color: '#FF8C42' }}>
                              {u.uid ? `UID ${u.uid}` : '—'}
                            </span>
                          </div>
                          {/* UUID: full id kept on title for accessibility, truncated on screen + copy button */}
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-[10px] font-mono" style={{ color: '#484f58' }} title={u.id}>
                              {u.id}
                            </span>
                            <CopyButton text={u.id} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td><span className="font-mono text-xs" style={{ color: '#FFD060' }}>{u.inventory.propA.toLocaleString()}</span></td>
                    <td><span className="font-mono text-xs" style={{ color: '#9B5CFF' }}>{u.inventory.propB.toLocaleString()}</span></td>
                    <td><span className="font-mono text-xs" style={{ color: '#8b949e' }}>{u.inventory.totalDamage.toLocaleString()}</span></td>
                    <td><span className="text-[11px]" style={{ color: '#484f58' }}>{u.createdAt ? new Date(u.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', year: '2-digit' }) : '—'}</span></td>
                    <td>
                      <button onClick={() => onSelectUser(u)} className="admin-btn admin-btn-primary !py-1.5 !px-3 text-xs">
                        查看详情
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination — simplified: 第X/Y页 + 跳转输入框 + 上一页/下一页 */}
          {(totalPages > 0) && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#21262d] gap-4 flex-wrap">
              {/* Page indicator */}
              <span className="text-xs shrink-0" style={{ color: '#8b949e' }}>
                第 {page} / {totalPages} 页，共 {total} 条
              </span>

              {/* Jump-to-page input + explicit jump button */}
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs" style={{ color: '#8b949e' }}>跳转至第</span>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  defaultValue={page}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const n = Number((e.target as HTMLInputElement).value);
                      if (n >= 1 && n <= totalPages) {
                        (e.target as HTMLInputElement).blur();
                        onPageChange(n);
                      } else {
                        // Visual hint: briefly flash red border
                        (e.target as HTMLInputElement).style.outline = '1px solid #f85149';
                        setTimeout(() => {
                          (e.target as HTMLInputElement).style.outline = '';
                        }, 1200);
                      }
                    }
                  }}
                  className="admin-input !w-14 !py-1 !px-2 !text-xs text-center"
                  style={{ color: '#e4e4e7' }}
                  aria-label="跳转到指定页码"
                />
                <span className="text-xs" style={{ color: '#8b949e' }}>页</span>
                <button
                  onClick={(e) => {
                    const input = (e.currentTarget.parentElement?.querySelector('input[type=number]') as HTMLInputElement);
                    if (!input) return;
                    const n = Number(input.value);
                    if (n >= 1 && n <= totalPages) {
                      input.blur();
                      onPageChange(n);
                    } else {
                      // Show error state briefly
                      input.style.outline = '1px solid #f85149';
                      setTimeout(() => { input.style.outline = ''; }, 1200);
                    }
                  }}
                  className="admin-btn admin-btn-secondary !py-1 !px-2 text-xs"
                  style={{ color: '#8b949e' }}
                  title="跳转"
                >
                  跳转
                </button>
              </div>

              {/* Previous / Next */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => onPageChange(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="admin-btn admin-btn-secondary !py-1.5 !px-3 text-xs"
                  style={{ opacity: page <= 1 ? 0.4 : 1 }}
                >
                  ‹ 上一页
                </button>
                <button
                  onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="admin-btn admin-btn-secondary !py-1.5 !px-3 text-xs"
                  style={{ opacity: page >= totalPages ? 0.4 : 1 }}
                >
                  下一页 ›
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── User Detail Panel ────────────────────────────────────────────────────────

function UserDetailPanel({ searchResult, selectedActivity, selectedActivityId, setSelectedActivityId, selectedDamage, onInventorySave, onUnlock, onLock, listLoading }: {
  searchResult: SearchResult;
  selectedActivity: ActivityInfo | undefined;
  selectedActivityId: number | null;
  setSelectedActivityId: (id: number) => void;
  selectedDamage: number;
  onInventorySave: (propType: 'prop_a' | 'prop_b', newCount: number, reason: string) => Promise<void>;
  onUnlock: (ms: MilestoneDef) => void;
  onLock: (ms: MilestoneDef) => void;
  listLoading: boolean;
}) {
  const activityId = selectedActivityId ?? searchResult.activities[0]?.id ?? 0;
  const currentClaims = searchResult.milestoneClaims[String(activityId)] ?? {};

  return (
    <div className="flex flex-1 min-h-0">
      {/* LEFT: Activity nav */}
      <div className="w-56 shrink-0 border-r border-[#30363d] bg-[#0d1117]/50 overflow-y-auto">
        <div className="p-3">
          <div className="text-[11px] font-semibold text-[#484f58] uppercase tracking-wider mb-2 px-1">活动列表</div>
          {/* User card */}
          <div className="mb-4 px-2 py-2.5 rounded-xl bg-[#161b22] border border-[#21262d]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ background: 'rgba(255,183,71,0.1)', border: '1px solid rgba(255,183,71,0.15)' }}>{searchResult.user.avatar}</div>
              <div className="min-w-0">
                {/* UID: prominent orange badge (primary identifier) */}
                {searchResult.user.uid && (
                  <div className="mb-0.5">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold" style={{ background: 'rgba(255,140,66,0.12)', color: '#FF8C42', border: '1px solid rgba(255,140,66,0.2)' }}>
                      UID {searchResult.user.uid}
                    </span>
                  </div>
                )}
                {/* UUID: full id visible (was truncated per REPARK 7.0 (2026-09-16)
                    — customer confirms full UUID is the canonical identifier; keep
                    the copy button for one-click retrieval. */}
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-[10px] font-mono break-all" style={{ color: '#484f58' }} title={searchResult.user.id}>
                    {searchResult.user.id}
                  </span>
                  <CopyButton text={searchResult.user.id} />
                </div>
              </div>
            </div>
            {searchResult.user.email && <div className="text-[10px] text-[#484f58] mt-1 truncate">{searchResult.user.email}</div>}
          </div>
          {searchResult.activities.length === 0 ? (
            <div className="text-center py-6"><p className="text-xs text-[#484f58]">暂无活动</p></div>
          ) : (
            <div className="space-y-1">
              {searchResult.activities.map((act) => {
                const isSelected = selectedActivityId === act.id;
                return (
                  <button key={act.id} onClick={() => setSelectedActivityId(act.id)}
                    className="w-full text-left px-3 py-2.5 rounded-lg transition-all"
                    style={{ background: isSelected ? 'rgba(43,125,233,0.08)' : undefined, borderLeft: isSelected ? '2px solid #2B7DE9' : '2px solid transparent' }}>
                    <div className="text-xs font-medium truncate" style={{ color: isSelected ? '#2B7DE9' : '#8b949e' }}>{act.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] font-mono" style={{ color: '#484f58' }}>ID {act.id}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={act.status === 'ENABLED' ? { background: 'rgba(35,134,54,0.15)', color: '#238636', border: '1px solid rgba(35,134,54,0.3)' } : { background: 'rgba(72,79,88,0.15)', color: '#8b949e', border: '1px solid rgba(72,79,88,0.3)' }}>
                        {act.status === 'ENABLED' ? '启用' : '禁用'}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] font-mono" style={{ color: '#484f58' }}>活动伤害 {act.totalDamage.toLocaleString()}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Detail */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Activity banner */}
        {selectedActivity && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#161b22] border border-[#21262d]">
            <ShieldAlert size={13} style={{ color: '#484f58' }} />
            <span className="text-xs text-[#8b949e]">
              当前查看：<span className="text-white font-medium">{selectedActivity.name}</span>
              {selectedActivity.status === 'ENABLED' && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">启用中</span>}
            </span>
          </div>
        )}

        {/* Damage */}
        {/* BUG-101 (2026-09-16): replace dark-only hex colors with theme-aware
            CSS variables defined in app/admin/admin.css so the card remains
            readable in both light and dark themes. The accent (#FF6B35 /
            trending-up icon) is intentionally NOT touched — it is the orange
            brand color and reads correctly on both backgrounds. */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--admin-text-muted)' }}>本活动贡献伤害</h2>
          <div className="rounded-2xl border p-6" style={{ background: 'var(--admin-bg-elevated)', borderColor: 'var(--admin-border)' }}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,107,53,0.1)', border: '1px solid rgba(255,107,53,0.15)' }}>
                <TrendingUp size={20} style={{ color: '#FF6B35' }} />
              </div>
              <div>
                <div className="font-mono font-black" style={{ fontSize: '48px', fontWeight: 900, color: 'var(--admin-text-strong)', fontFamily: "'JetBrains Mono', monospace", lineHeight: 1, letterSpacing: '-2px' }}>{selectedDamage.toLocaleString()}</div>
                <div className="text-xs" style={{ color: 'var(--admin-text-muted)' }}>
                  {selectedActivity
                    ? `「${selectedActivity.name}」活动内的玩家贡献伤害`
                    : '请先选择左侧活动（默认从该活动的 user_activity_stats 读取）'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* REPARK 7.0 (2026-09-18) ISSUE 2: hide the entire 道具数量管理
            block when the currently selected activity has no config.items.
            The flag comes from /api/admin/users/search → ActivityInfo.hasItems.
            We do NOT fall back to getActiveActivity() — the admin detail panel
            tracks the operator's per-activity selection, which is the source of
            truth here. Activity 7 (ENERGY) has no items → block disappears;
            activity 1 (SPINE) has items → block renders normally. */}
        {(selectedActivity?.hasItems ?? false) && (
          <div>
            <h2 className="text-sm font-semibold text-[#8b949e] uppercase tracking-wider mb-3">道具数量管理</h2>
          {/* BUG-102 round-2: 恢复黄色提示 Banner，文案替换为最终版：
                修改道具数量将直接影响用户可攻击次数，请谨慎操作
              原旧文案"修改道具数量将直接影响用户可攻击次数，所有变更记录操作日志。"已废弃，
              该 Banner 与 ReasonModal 中"此操作将修改用户数据，所有变更记录操作日志。"
              是两处独立的提示，本 Banner 仅承担"影响可攻击次数"与"请谨慎"两个语义点。
              该 div 仅为展示用途，未绑定 state / event handler / API / audit / permission，
              删除不影响 PropCard 修改按钮、onInventorySave、update_inventory API、
              admin_audit_log 写入。 */}
          <div
            className="mb-3 flex items-start gap-2 rounded-lg p-3 text-[12px]"
            style={{ background: 'rgba(255,183,71,0.10)', border: '1px solid rgba(255,183,71,0.30)', color: '#F57F17', lineHeight: 1.5 }}
          >
            <AlertTriangle size={14} style={{ color: '#F57F17', marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
            <span>修改道具数量将直接影响用户可攻击次数，请谨慎操作</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <PropCard label="闪电符文" propKey="propA" value={searchResult.inventory.propA} color="#FFD060" icon={<Zap size={14} style={{ color: '#FFD060' }} />} onSave={onInventorySave} activityId={activityId} />
            <PropCard label="潮汐晶石" propKey="propB" value={searchResult.inventory.propB} color="#9B5CFF" icon={<Gem size={14} style={{ color: '#9B5CFF' }} />} onSave={onInventorySave} activityId={activityId} />
          </div>
        </div>
        )}

        {/* Milestones */}
        <div>
          <h2 className="text-sm font-semibold text-[#8b949e] uppercase tracking-wider mb-3">里程碑奖励进度</h2>
          <div className="rounded-xl border border-[#21262d] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#21262d]" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#484f58] uppercase tracking-wider">伤害阈值</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#484f58] uppercase tracking-wider">奖励</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#484f58] uppercase tracking-wider">状态</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#484f58] uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const msList = selectedActivity?.milestones ?? [];
                  if (msList.length === 0) {
                    return (
                      <tr><td colSpan={4} className="text-center py-8 text-xs" style={{ color: '#484f58' }}>
                        {selectedActivity ? '该活动暂无里程碑数据（请在活动配置中添加）' : '请先选择左侧活动'}
                      </td></tr>
                    );
                  }
                  return msList.map((ms) => {
                    // Milestone claims keyed by either the literal config id
                    // (for activities that store `m<unix-ts>` ids) or the
                    // digit-only form (which is what milestone_rewards
                    // actually stores as INTEGER per aws_01_schema.sql).
                    // We try ms.id (display) → ms.idNumeric → threshold.
                    const numericKey = ms.idNumeric != null ? String(ms.idNumeric) : null;
                    const claim =
                      currentClaims[String(ms.id)] ??
                      (numericKey ? currentClaims[numericKey] : undefined) ??
                      currentClaims[String(ms.threshold)];
                    return (
                      <MilestoneRow
                        key={ms.id}
                        ms={ms}
                        claim={claim}
                        damage={selectedDamage}
                        onUnlock={onUnlock}
                        onLock={onLock}
                      />
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

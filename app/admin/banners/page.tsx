'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { adminFetch } from '@/app/admin/lib/adminApi';
import { fetchWithTimeout, humanizeFetchError } from '@/app/lib/fetchWithTimeout';
import toast from 'react-hot-toast';
import {
  Plus, Trash2, Image, AlertCircle, Clock, Eye, EyeOff,
  RotateCcw, Settings, Save, Upload, RefreshCw,
} from 'lucide-react';

// P0 2026-07-30: Resolve a relative upload URL (e.g. "/uploads/banners/xxx.jpg")
// to an absolute URL using window.location.origin. Falls back to the original
// URL so data: URLs and absolute URLs pass through unchanged.
function resolveBannerUrl(raw: string): string {
  if (!raw) return raw;
  // Already absolute (http://, https://, data:)
  if (/^(https?:\/\/|data:)/i.test(raw)) return raw;
  // Strip stale ?t= cache buster from the stored value
  const clean = raw.replace(/\?t=\d+$/, '');
  // P0 2026-07-30: In production, Next.js does NOT dynamically serve files
  // from public/uploads/ at runtime. Rewrite /uploads/<path> → /api/uploads/<path>
  // so the new dynamic route (app/api/uploads/[...path]/route.ts) streams the file.
  const resolved = clean.startsWith('/uploads')
    ? `/api/uploads${clean.slice('/uploads'.length)}`
    : clean;
  // Client: prefix origin. Server (SSR): pass through as relative.
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${resolved}`;
  }
  return resolved;
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface BannerItem {
  id: string;
  imageUrl: string;
  targetActivityId: string | null;
  sortWeight: number;
  isEnabled: boolean;
  showCountdown: boolean;
  createdAt: string;
}

interface ActivityOption {
  id: number;
  name: string;
}

interface BannerGlobalConfig {
  isGlobalEnabled: boolean;
  isCarouselEnabled: boolean;
  carouselInterval: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function validateFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) return '文件类型不支持，请上传 JPG / PNG / WEBP 格式';
  if (file.size > MAX_FILE_SIZE) return '图片大小不能超过 10MB';
  return null;
}

function ToggleSwitch({
  checked, disabled, onChange, ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onChange}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${
        checked ? 'bg-emerald-500' : 'bg-zinc-600'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </button>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function AdminBannersPage() {
  const [globalConfig, setGlobalConfig] = useState<BannerGlobalConfig>({
    isGlobalEnabled: false,
    isCarouselEnabled: true,
    carouselInterval: 5,
  });

  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [activities, setActivities] = useState<ActivityOption[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving,  setIsSaving]  = useState(false);
  // P0 2026-07-30: per-banner upload in-progress flag — drives label disable + "上传中" text
  const [isUploading, setIsUploading] = useState(false);
  const [uploadBannerId, setUploadBannerId] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const saveGuardRef = useRef<boolean>(false);
  const SAVE_LOCKOUT_MS = 1000;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [bannersRes, activitiesRes] = await Promise.all([
        adminFetch('/api/admin/banners'),
        adminFetch('/api/admin/activity'),
      ]);
      const [bannersData, activitiesData] = await Promise.all([
        bannersRes.json(),
        activitiesRes.json(),
      ]);
      if (bannersData.ok) {
        setBanners(bannersData.items ?? []);
        setGlobalConfig(bannersData.global ?? {
          isGlobalEnabled: false,
          isCarouselEnabled: true,
          carouselInterval: 5,
        });
      }
      if (activitiesData.ok) {
        setActivities(
          (activitiesData.data ?? []).map((a: { id: number; name: string }) => ({
            id: a.id,
            name: a.name,
          })),
        );
      }
    } catch {
      toast.error('网络错误，请刷新重试');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const updateBannerField = useCallback(
    (id: string, field: keyof BannerItem, value: unknown) => {
      setBanners((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
      setPendingChanges(true);
    },
    [],
  );

  const handleImageFile = useCallback(
    async (id: string, file: File) => {
      const err = validateFile(file);
      if (err) { toast.error(err); return; }
      // P0 2026-07-30: block concurrent uploads and show loading feedback
      if (isUploading) { toast.error('请等待当前上传完成'); return; }
      setIsUploading(true);
      setUploadBannerId(id);
      const previewUrl = URL.createObjectURL(file);
      updateBannerField(id, 'imageUrl', previewUrl);
      try {
        const form = new FormData();
        form.append('file', file);
        const result = await fetchWithTimeout<{ ok: boolean; data?: { url?: string }; error?: { message: string } }>(
          '/api/admin/upload',
          { method: 'POST', body: form, timeoutMs: 0 },
        );
        const json = result.data;
        if (json?.ok && json.data?.url) {
          URL.revokeObjectURL(previewUrl);
          const stableUrl = json.data.url.replace(/\?t=\d+$/, '');
          updateBannerField(id, 'imageUrl', stableUrl);
          toast.success(
            (t) => (
              <span className="flex items-center gap-2">
                <span>Banner 上传成功</span>
                <span className="text-xs text-yellow-400 font-medium border border-yellow-400/30 bg-yellow-400/10 rounded px-1.5 py-0.5">
                  记得保存
                </span>
              </span>
            ),
            { duration: 4000 }
          );
        } else {
          toast.error(json?.error?.message ?? '上传失败');
        }
      } catch (e) {
        // P0 2026-07-30: every error path now surfaces a clear toast — no silent failures
        toast.error(humanizeFetchError(e));
      } finally {
        setIsUploading(false);
        setUploadBannerId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateBannerField, isUploading],
  );

  const addBanner = useCallback(() => {
    const maxWeight = banners.length ? Math.max(...banners.map((b) => b.sortWeight)) : 0;
    const newBanner: BannerItem = {
      id: `new-${Date.now()}`,
      imageUrl: '',
      targetActivityId: null,
      sortWeight: maxWeight + 1,
      isEnabled: false,
      showCountdown: false,
      createdAt: new Date().toISOString(),
    };
    setBanners((prev) => [...prev, newBanner]);
    setPendingChanges(true);
  }, [banners]);

  const handleDelete = useCallback((id: string) => setDeleteConfirmId(id), []);

  const confirmDelete = useCallback(() => {
    if (!deleteConfirmId) return;
    setBanners((prev) => prev.filter((b) => b.id !== deleteConfirmId));
    setPendingChanges(true);
    setDeleteConfirmId(null);
    toast.success('Banner 已删除');
  }, [deleteConfirmId]);

  const handleSave = useCallback(async () => {
    if (saveGuardRef.current) {
      toast.error('保存操作太频繁，请稍后再试');
      return;
    }
    saveGuardRef.current = true;
    setTimeout(() => { saveGuardRef.current = false; }, SAVE_LOCKOUT_MS);
    setIsSaving(true);
    try {
      const sanitizedItems = banners.map((b) => ({
        ...b,
        imageUrl: b.imageUrl.replace(/\?t=\d+$/, ''),
      }));
      const res = await adminFetch('/api/admin/banners/update', {
        method: 'POST',
        body: JSON.stringify({ global: globalConfig, items: sanitizedItems }),
      });
      const data = await res.json();
      if (data.ok) {
        setPendingChanges(false);
        toast.success('全局配置和 Banner 列表已保存');
        loadData();
      } else {
        toast.error(data.error?.message ?? '保存失败');
      }
    } catch {
      toast.error('网络错误，请稍后重试');
    } finally {
      setIsSaving(false);
    }
  }, [banners, globalConfig, loadData]);

  const updateGlobal = useCallback((field: keyof BannerGlobalConfig, value: unknown) => {
    setGlobalConfig((prev) => ({ ...prev, [field]: value }));
    setPendingChanges(true);
  }, []);

  return (
    <div className="space-y-8">

      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="admin-page-title">Banner 管理</h1>
          <p className="admin-page-desc">管理首页活动入口 Banner 与轮播设置</p>
        </div>
        <div className="flex items-center gap-3">
          {pendingChanges && (
            <span className="text-xs text-zinc-400 flex items-center gap-1">
              <AlertCircle size={13} />
              有未保存的更改
            </span>
          )}
          <button onClick={addBanner} className="admin-btn admin-btn-primary">
            <Plus size={14} />
            新增 Banner
          </button>
        </div>
      </div>

      {/* ── Global Config ─────────────────────────────────────────────────── */}
      <div className="admin-card">
        <div className="flex items-center gap-2 mb-5">
          <Settings size={15} className="text-zinc-500" />
          <h2 className="admin-card-title !mb-0 !pb-0">全局规则</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-900/40 border border-zinc-800">
            <div>
              <div className="text-sm font-medium text-zinc-100">Banner 总开关</div>
              <div className="text-xs text-zinc-500 mt-0.5">关闭后所有 Banner 不展示</div>
            </div>
            <ToggleSwitch
              checked={globalConfig.isGlobalEnabled}
              onChange={() => updateGlobal('isGlobalEnabled', !globalConfig.isGlobalEnabled)}
              ariaLabel="Banner 总开关"
            />
          </div>

          <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-900/40 border border-zinc-800">
            <div>
              <div className="text-sm font-medium text-zinc-100">轮播开关</div>
              <div className="text-xs text-zinc-500 mt-0.5">多张 Banner 自动轮播</div>
            </div>
            <ToggleSwitch
              checked={globalConfig.isCarouselEnabled}
              onChange={() => updateGlobal('isCarouselEnabled', !globalConfig.isCarouselEnabled)}
              ariaLabel="轮播开关"
            />
          </div>

          <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-900/40 border border-zinc-800">
            <div>
              <div className="text-sm font-medium text-zinc-100">轮播间隔</div>
              <div className="text-xs text-zinc-500 mt-0.5">单位：秒</div>
            </div>
            <div className="flex items-center gap-1.5">
              <RotateCcw size={11} className="text-zinc-500" />
              <input
                type="number"
                min={1}
                max={60}
                aria-label="轮播间隔（秒）"
                value={globalConfig.carouselInterval}
                onChange={(e) =>
                  updateGlobal('carouselInterval', Math.max(1, parseInt(e.target.value) || 1))
                }
                className="admin-input !py-1 !w-14 text-center"
              />
              <span className="text-xs text-zinc-500">秒</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Loading / Empty / Banner Cards ────────────────────────────────── */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 rounded-lg border border-zinc-800 bg-zinc-900/30">
          <RefreshCw size={20} className="animate-spin text-zinc-500 mb-3" />
          <span className="text-zinc-500 text-sm">加载中…</span>
        </div>
      ) : banners.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/20">
          <Image size={32} className="text-zinc-600 mb-3" />
          <h3 className="text-sm font-medium text-zinc-300 mb-1">暂无 Banner</h3>
          <p className="text-xs text-zinc-600 mb-4">点击上方「新增 Banner」创建第一条记录</p>
          <button onClick={addBanner} className="admin-btn admin-btn-primary">
            <Plus size={14} />
            新增 Banner
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {banners.map((banner) => {
            const isNew = banner.id.startsWith('new-');
            return (
              <div
                key={banner.id}
                className={`rounded-lg border overflow-hidden transition-colors ${
                  banner.isEnabled
                    ? 'border-zinc-700 bg-[#121215]'
                    : 'border-zinc-800 bg-zinc-900/40 opacity-70'
                }`}
              >
                <div className="relative aspect-[16/9] bg-zinc-950 overflow-hidden group">
                  {banner.imageUrl ? (
                    <img
                      src={resolveBannerUrl(banner.imageUrl)}
                      alt="Banner 预览"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // P0 2026-07-30: if the resolved URL fails (e.g. relative path
                        // not prefixed with origin), show a clean broken-image fallback
                        // instead of the browser's default broken-image icon.
                        const img = e.currentTarget;
                        img.style.display = 'none';
                        const parent = img.parentElement as HTMLElement;
                        if (parent) {
                          const fallback = parent.querySelector<HTMLElement>('[data-banner-fallback]');
                          if (fallback) fallback.style.display = 'flex';
                        }
                      }}
                    />
                  ) : null}
                  {/* Fallback shown when imageUrl is empty OR on load error */}
                  <div
                    data-banner-fallback
                    className="absolute inset-0 flex flex-col items-center justify-center gap-2"
                    style={{ display: banner.imageUrl ? 'none' : 'flex' }}
                  >
                    <Image size={24} className="text-zinc-700" />
                    <span className="text-xs text-zinc-600">请上传图片</span>
                  </div>

                  <label
                    className={`absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/60 transition-opacity cursor-pointer
                      ${isUploading && uploadBannerId === banner.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                  >
                    {isUploading && uploadBannerId === banner.id ? (
                      <>
                        {/* Spinner — no external dependency needed */}
                        <svg className="animate-spin text-white" width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                        <span className="text-xs text-white font-medium">上传中…</span>
                      </>
                    ) : (
                      <>
                        <Upload size={18} className="text-zinc-100" />
                        <span className="text-xs text-zinc-100 font-medium">上传图片</span>
                        <span className="text-[10px] text-zinc-400">JPG / PNG / WEBP · ≤10MB</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={isUploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImageFile(banner.id, file);
                      }}
                    />
                  </label>

                  <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
                    {banner.isEnabled ? (
                      <span className="admin-badge admin-badge-success">
                        <Eye size={9} />展示中
                      </span>
                    ) : (
                      <span className="admin-badge border-zinc-700 text-zinc-500">
                        <EyeOff size={9} />已隐藏
                      </span>
                    )}
                    {banner.showCountdown && banner.isEnabled && (
                      <span className="admin-badge admin-badge-warning">
                        <Clock size={9} />倒计时
                      </span>
                    )}
                    {isNew && (
                      <span className="admin-badge admin-badge-warning">新建</span>
                    )}
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  <div>
                    <label className="admin-label" htmlFor={`activity-${banner.id}`}>关联活动</label>
                    <select
                      id={`activity-${banner.id}`}
                      aria-label="关联活动"
                      value={banner.targetActivityId ?? ''}
                      onChange={(e) =>
                        updateBannerField(
                          banner.id,
                          'targetActivityId',
                          e.target.value ? String(e.target.value) : null,
                        )
                      }
                      className="admin-input"
                    >
                      <option value="">— 无关联 —</option>
                      {activities.map((a) => (
                        <option key={a.id} value={String(a.id)}>
                          #{a.id} {a.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="admin-label" htmlFor={`sort-${banner.id}`}>排序权重</label>
                    <input
                      id={`sort-${banner.id}`}
                      type="number"
                      min={0}
                      aria-label="排序权重"
                      value={banner.sortWeight}
                      onChange={(e) =>
                        updateBannerField(
                          banner.id,
                          'sortWeight',
                          Math.max(0, parseInt(e.target.value) || 0),
                        )
                      }
                      className="admin-input"
                    />
                    <p className="text-[10px] text-zinc-600 mt-1">数值越小排序越靠前</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/40 border border-zinc-800">
                      <span className="text-xs text-zinc-400">展示</span>
                      <ToggleSwitch
                        checked={banner.isEnabled}
                        onChange={() => {
                          const next = !banner.isEnabled;
                          updateBannerField(banner.id, 'isEnabled', next);
                          if (!next) updateBannerField(banner.id, 'showCountdown', false);
                        }}
                        ariaLabel="Banner 展示开关"
                      />
                    </div>
                    <div className={`flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/40 border border-zinc-800 ${!banner.isEnabled ? 'opacity-40' : ''}`}>
                      <span className="text-xs text-zinc-400">倒计时</span>
                      <ToggleSwitch
                        checked={banner.showCountdown}
                        disabled={!banner.isEnabled}
                        onChange={() => {
                          if (!banner.isEnabled) return;
                          updateBannerField(banner.id, 'showCountdown', !banner.showCountdown);
                        }}
                        ariaLabel="Banner 倒计时开关"
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(banner.id)}
                    className="admin-btn admin-btn-danger w-full"
                  >
                    <Trash2 size={13} />
                    删除此 Banner
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Sticky Save Bar ────────────────────────────────────────────────── */}
      {pendingChanges && (
        <div className="sticky bottom-6 z-40 flex items-center justify-between px-5 py-3 rounded-lg bg-[#121215] border border-yellow-500/30 shadow-2xl ring-1 ring-yellow-500/20">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500" />
            </span>
            <span className="text-sm text-yellow-400 font-medium">您有未保存的更改</span>
            <span className="text-xs text-zinc-500">上传/修改后必须点击「保存更改」才能生效</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadData} className="admin-btn admin-btn-secondary">放弃更改</button>
            <button onClick={handleSave} disabled={isSaving} className="admin-btn admin-btn-primary">
              {isSaving ? (
                <><RefreshCw size={13} className="animate-spin" />保存中…</>
              ) : (
                <><Save size={13} />保存更改</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ───────────────────────────────────────── */}
      {deleteConfirmId && (
        <div className="admin-modal-backdrop">
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-red-950/30 border border-red-800/50">
                <Trash2 size={16} className="text-red-400" />
              </div>
              <div>
                <h3 className="admin-modal-title">确认删除</h3>
                <p className="admin-modal-desc">此操作不可撤销，确定要删除此 Banner 吗？</p>
              </div>
            </div>
            <div className="admin-modal-actions">
              <button onClick={() => setDeleteConfirmId(null)} className="admin-btn admin-btn-secondary">取消</button>
              <button onClick={confirmDelete} className="admin-btn admin-btn-danger">确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
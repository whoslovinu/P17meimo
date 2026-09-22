'use client';

/**
 * BadgeEditorForm — Shared form for create / edit.
 *
 * Phase 2 (2026-09-02).
 *
 * Fields:
 *   - ID          readonly, server-assigned (BIGSERIAL)
 *   - Name        required, 1-40 chars
 *   - Thumbnail   URL input (http/https only)
 *   - Description optional, ≤200 chars
 *   - Status      active toggle (visible on edit mode)
 */

import { useState, useEffect } from 'react';
import { Save, X, Image as ImageIcon, AlertCircle } from 'lucide-react';

export interface BadgeFormValues {
  name:        string;
  thumbnail:   string;
  description: string;
  is_active:   boolean;
}

export interface BadgeEditorFormProps {
  mode:        'create' | 'edit';
  initial?:    Partial<BadgeFormValues> & { id?: number };
  onSubmit:    (values: BadgeFormValues) => Promise<void>;
  onCancel:    () => void;
}

export function BadgeEditorForm({
  mode,
  initial,
  onSubmit,
  onCancel,
}: BadgeEditorFormProps) {
  const [name,        setName]        = useState(initial?.name ?? '');
  const [thumbnail,   setThumbnail]   = useState(initial?.thumbnail ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [isActive,    setIsActive]    = useState(initial?.is_active ?? true);
  const [isSaving,    setIsSaving]    = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [thumbError,  setThumbError]  = useState(false);

  // Re-sync when initial values arrive (edit mode async load).
  useEffect(() => {
    if (!initial) return;
    setName(initial.name ?? '');
    setThumbnail(initial.thumbnail ?? '');
    setDescription(initial.description ?? '');
    setIsActive(initial.is_active ?? true);
    setThumbError(false);
  }, [initial?.name, initial?.thumbnail, initial?.description, initial?.is_active, initial]);

  const trimmedName   = name.trim();
  const trimmedThumb  = thumbnail.trim();
  const trimmedDesc   = description.trim();
  const nameInvalid   = trimmedName.length === 0 || trimmedName.length > 40;
  const descInvalid   = trimmedDesc.length > 200;
  const thumbInvalid  = trimmedThumb.length === 0 || (() => {
    try {
      const u = new URL(trimmedThumb);
      return u.protocol !== 'http:' && u.protocol !== 'https:';
    } catch {
      return true;
    }
  })();
  const canSave = !nameInvalid && !descInvalid && !thumbInvalid && !isSaving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setIsSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: trimmedName,
        thumbnail: trimmedThumb,
        description: trimmedDesc,
        is_active: isActive,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
      {/* ID (readonly) */}
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">
          勋章 ID
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={initial?.id ? String(initial.id) : '新建后自动分配'}
            readOnly
            disabled
            className="admin-input flex-1 font-mono text-zinc-500 cursor-not-allowed"
          />
          {initial?.id && (
            <span className="text-[11px] text-zinc-600 shrink-0">
              BIGSERIAL · 不可编辑
            </span>
          )}
        </div>
      </div>

      {/* Name */}
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">
          名称 <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          placeholder="例:初级挑战者"
          className="admin-input w-full"
        />
        <div className="flex items-center justify-between mt-1">
          <span className={`text-[11px] ${nameInvalid && name ? 'text-red-400' : 'text-zinc-600'}`}>
            {nameInvalid && name ? '名称必须为 1-40 个字符' : '1-40 个字符'}
          </span>
          <span className="text-[11px] text-zinc-600">{trimmedName.length}/40</span>
        </div>
      </div>

      {/* Thumbnail */}
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">
          缩略图 URL <span className="text-red-400">*</span>
        </label>
        <div className="flex gap-3">
          <div className="w-20 h-20 shrink-0 rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800 flex items-center justify-center">
            {trimmedThumb && !thumbError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={trimmedThumb}
                alt="预览"
                className="w-full h-full object-cover"
                onError={() => setThumbError(true)}
              />
            ) : (
              <ImageIcon size={20} className="text-zinc-600" />
            )}
          </div>
          <input
            type="url"
            value={thumbnail}
            onChange={(e) => {
              setThumbnail(e.target.value);
              setThumbError(false);
            }}
            placeholder="https://cdn.example.com/badge/xxx.png"
            className="admin-input flex-1"
          />
        </div>
        <p className="mt-1 text-[11px] text-zinc-600">
          仅支持 http / https · 建议 100x100 px
        </p>
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">
          描述 <span className="text-zinc-600">(可选)</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={220}
          rows={3}
          placeholder="仅管理员可见的描述"
          className="admin-input w-full resize-none"
        />
        <div className="flex items-center justify-between mt-1">
          <span className={`text-[11px] ${descInvalid ? 'text-red-400' : 'text-zinc-600'}`}>
            {descInvalid ? '描述不能超过 200 个字符' : '最多 200 个字符'}
          </span>
          <span className="text-[11px] text-zinc-600">{trimmedDesc.length}/200</span>
        </div>
      </div>

      {/* Status toggle — only in edit mode (create defaults to active) */}
      {mode === 'edit' && (
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">
            状态
          </label>
          <button
            type="button"
            onClick={() => setIsActive(!isActive)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
              isActive
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-zinc-700 bg-zinc-800 text-zinc-400'
            }`}
          >
            <span
              className={`w-8 h-4 rounded-full p-0.5 transition-colors ${
                isActive ? 'bg-emerald-500' : 'bg-zinc-600'
              }`}
            >
              <span
                className={`block w-3 h-3 rounded-full bg-white transition-transform ${
                  isActive ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </span>
            <span className="text-xs font-medium">
              {isActive ? '启用中' : '已停用'}
            </span>
          </button>
          <p className="mt-1 text-[11px] text-zinc-600">
            停用后,该勋章仍保留在数据库中,只是不可被预览/引用
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
        <button
          type="submit"
          disabled={!canSave}
          className="admin-btn admin-btn-primary admin-btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save size={13} />
          {isSaving ? '保存中…' : mode === 'create' ? '创建' : '保存修改'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="admin-btn admin-btn-secondary admin-btn-sm"
        >
          <X size={13} />
          取消
        </button>
      </div>
    </form>
  );
}

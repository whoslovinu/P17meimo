'use client';

import { useState, useEffect } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { fetchWithTimeout, FetchError, humanizeFetchError } from '@/app/lib/fetchWithTimeout';
import { setAdminSession } from '../lib/adminApi';

export default function AdminLoginPage() {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Always clean stale client-side session on mount — trust the server Cookie, not localStorage
  useEffect(() => {
    localStorage.removeItem('admin_session');
  }, []);

  // Redirect only after explicit successful login — never on mount
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password.trim()) {
      setError('请输入管理员密码');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const result = await fetchWithTimeout<{ ok: boolean; error?: { message: string } }>(
        '/api/admin/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ password }),
        }
      );

      const data = result.data;

      if (result.ok && data?.ok) {
        setAdminSession();
        // Hard redirect: force full page reload so Middleware re-reads the HttpOnly cookie
        window.location.href = '/admin';
        return;
      }

      // REPARK 6.0 (2026-07-29): For /api/admin/login, ALL error responses
      // are credential-validation signals (401 wrong password, 400 empty
      // password, 429 rate-limited) — NEVER session-expired. Hardened
      // here so a future tweak to humanizeFetchError() can't regress
      // this page.
      const raw = data?.error?.message ?? '';
      const safeMsg = /请先登录|登录会话已失效/.test(raw)
        ? '密码错误，请核对后重新输入'
        : raw || '密码错误，请核对后重新输入';
      setError(safeMsg);
    } catch (err) {
      // humanizeFetchError() is route-aware, but as a defence-in-depth we
      // also strip any "请先登录 / 会话已失效" leftovers for the login route.
      let msg = humanizeFetchError(err as FetchError);
      if (/请先登录|登录会话已失效/.test(msg)) {
        msg = '密码错误，请核对后重新输入';
      }
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Render directly — no hydration flash guard needed for a simple login form
  return (
    <div className="min-h-screen bg-[#09090B] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* ── Card ─────────────────────────────────────── */}
        <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-8">

          {/* ── Header ─────────────────────────────────── */}
          <div className="mb-7">
            <h1 className="text-lg font-medium text-zinc-100 leading-none mb-1.5">后台管理</h1>
            <p className="text-sm text-zinc-400">授权管理员入口</p>
          </div>

          {/* ── Form ──────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>

            {/* Error banner */}
            {error && (
              <div className="flex items-center gap-2.5 p-3 rounded-lg border border-red-800/50 bg-red-950/30">
                <span className="w-px h-8 bg-red-500/60 rounded-full shrink-0" />
                <p className="text-sm text-red-400 leading-snug">{error}</p>
              </div>
            )}

            {/* Password field */}
            <div>
              <label htmlFor="password" className="block text-xs text-zinc-500 mb-1.5">
                密钥
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="输入管理员密钥"
                  className={[
                    'w-full px-3.5 py-2.5 pr-10 rounded-lg text-sm transition-colors duration-150',
                    'bg-zinc-900/80 border text-zinc-100 placeholder:text-zinc-600',
                    error
                      ? 'border-red-800/70 focus:outline-none focus:border-red-600'
                      : 'border-zinc-800 focus:outline-none focus:border-zinc-600',
                    isLoading ? 'opacity-50' : '',
                  ].join(' ')}
                  disabled={isLoading}
                  autoComplete="current-password"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
                  tabIndex={-1}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword
                    ? <EyeOff size={14} />
                    : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Hidden username (Chromium autofill hygiene) */}
            <input
              type="text"
              name="username"
              value="admin"
              autoComplete="username"
              readOnly
              hidden
              tabIndex={-1}
              aria-hidden="true"
            />

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className={[
                'w-full py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 cursor-pointer select-none',
                isLoading
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  : 'bg-zinc-100 hover:bg-white text-zinc-900',
              ].join(' ')}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  验证中...
                </span>
              ) : (
                '登录'
              )}
            </button>

          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-zinc-600 mt-4">
          Admin Management System
        </p>
      </div>
    </div>
  );
}

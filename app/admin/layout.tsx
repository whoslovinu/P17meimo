'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  Users,
  Image,
  Activity,
  Swords,
  LogOut,
  Loader2,
  Sun,
  Moon,
  KeyRound,
  X,
  Eye,
  EyeOff,
  Monitor,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { setAdminSession, clearAdminSession } from './lib/adminApi';
import { fetchWithTimeout } from '@/app/lib/fetchWithTimeout';
import {
  maybeHandleAdminUnauthorizedResponse,
} from './lib/handleAdminUnauthorized';
import { Toaster } from 'react-hot-toast';
import './admin.css';

type NavItem = {
  href: string | null;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  badge?: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: '控制台', icon: LayoutDashboard, exact: true },
  { href: '/admin/activities', label: '活动管理', icon: Activity },
  { href: '/admin/banners', label: 'Banner 管理', icon: Image },
  // REPARK 7.0 (2026-09-04) Admin sidebar cleanup: 实时监控 promoted from
  // dashboard quick-entry to top-level sidebar nav so operators can reach
  // it directly. Backed by the existing /admin/monitor page.
  { href: '/admin/monitor', label: '实时监控', icon: Monitor },
  // REPARK 7.0 (2026-09-11) P1-77 Phase A: Badge Management REMOVED from nav.
  // The local badge CRUD is superseded by Main Station as the single source
  // of truth. The milestone medalId preview now calls BadgeAdapter.getBadgeDetail()
  // via /api/admin/badge/preview — the local badges table is deprecated.
  // CRUD pages preserved at Phase C for rollback; nav removed immediately.
  // { href: '/admin/badges', label: '勋章管理', icon: Award },
  { href: '/admin/users', label: '用户管理', icon: Users },
];
// REMOVED FROM SIDEBAR (2026-09-04) per client cleanup:
//   「全局配置（开发中）」 — page + code preserved, only nav visibility removed.

type ThemeMode = 'dark' | 'light';
const THEME_STORAGE_KEY = 'admin_theme';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [theme, setTheme] = useState<ThemeMode>('dark');

  // Change-password Modal state — lifted here so the sidebar button can open it
  const [showChangePassword, setShowChangePassword] = useState(false);

  // Hydrate theme from localStorage (client only — no SSR mismatch)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    const resolved: ThemeMode = stored === 'light' ? 'light' : 'dark';
    setTheme(resolved);
    applyThemeToRoot(resolved);
  }, []);

  const applyThemeToRoot = useCallback((next: ThemeMode) => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    if (next === 'light') {
      html.classList.add('light');
      html.classList.remove('dark');
    } else {
      html.classList.add('dark');
      html.classList.remove('light');
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      }
      applyThemeToRoot(next);
      return next;
    });
  }, [applyThemeToRoot]);

  useEffect(() => {
    if (pathname === '/admin/login') {
      setIsAuthenticated(true);
      return;
    }

    const hasSession = localStorage.getItem('admin_session');
    if (!hasSession) {
      router.push('/admin/login');
      return;
    }

    setAdminSession();
    setIsAuthenticated(true);
  }, [pathname, router]);

  // ── Global /api/admin/* 401 interceptor ─────────────────────────────
  // Wrap window.fetch so ANY admin page that calls an admin endpoint and
  // receives an UNAUTHORIZED 401 (cookie missing / expired / tampered)
  // is gracefully nudged to /admin/login instead of dumping a raw
  // [HTTP_NON_2XX] error stack in front of the operator.
  //
  // We deliberately skip /api/admin/change-password's OLD_PASSWORD_MISMATCH
  // 401 (handled inside the Modal as "旧密码不正确") by checking the
  // error code in handleAdminUnauthorized.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (pathname === '/admin/login') return;

    const originalFetch = window.fetch.bind(window);
    window.fetch = function patchedAdminFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      return originalFetch(input, init).then((res) => {
        // Fire-and-forget — handleAdminUnauthorizedResponse handles its own errors.
        void maybeHandleAdminUnauthorizedResponse(res);
        return res;
      });
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [pathname]);

  const handleLogout = useCallback(async () => {
    clearAdminSession();
    await fetchWithTimeout('/api/admin/logout', {
      method: 'POST',
      credentials: 'include',
    });
    router.push('/admin/login');
  }, [router]);

  const isActive = (item: typeof NAV_ITEMS[0]) => {
    if (!item.href || !pathname) return false;
    if (item.exact) {
      return pathname === item.href;
    }
    return pathname.startsWith(item.href);
  };

  // Show loading while checking auth — theme-aware via CSS variables
  if (isAuthenticated === null) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--admin-bg)' }}
      >
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--admin-text-subtle)' }} />
          <p className="text-sm" style={{ color: 'var(--admin-text-subtle)' }}>验证中</p>
        </div>
      </div>
    );
  }

  // Don't render layout for login page (it has its own theme)
  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  // Toaster styling reacts to current theme
  const toasterStyle = theme === 'light'
    ? { background: '#FFFFFF', color: '#0F172A', border: '1px solid #E2E8F0' }
    : { background: '#121215', color: '#FAFAFA', border: '1px solid #27272A' };
  const toasterIconSecondary = theme === 'light' ? '#FFFFFF' : '#121215';

  return (
    <div className="admin-layout">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            ...toasterStyle,
            fontSize: '13px',
            borderRadius: '8px',
            padding: '10px 14px',
          },
          success: { iconTheme: { primary: theme === 'light' ? '#0F172A' : '#FAFAFA', secondary: toasterIconSecondary } },
          error:   { iconTheme: { primary: '#FCA5A5', secondary: toasterIconSecondary } },
        }}
      />
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="admin-logo">
          <span className="admin-logo-text">Admin</span>
          <span className="admin-logo-sub">管理系统</span>
        </div>

        <nav className="admin-nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            if (!item.href) {
              return (
                <div
                  key={item.label}
                  className="admin-nav-item opacity-50 cursor-not-allowed pointer-events-none flex items-center gap-2"
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className="ml-auto text-[10px] text-zinc-500">{item.badge}</span>
                  )}
                </div>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`admin-nav-item ${active ? 'active' : ''}`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="admin-footer">
          {/* Change Password — sits above theme toggle for discoverability */}
          <button
            onClick={() => setShowChangePassword(true)}
            className="admin-back-link"
            title="修改后台登录密码"
            aria-label="修改后台登录密码"
          >
            <KeyRound size={13} />
            修改密码
          </button>

          {/* Theme Toggle — placed above logout per spec */}
          <button
            onClick={toggleTheme}
            className="admin-back-link"
            title={theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}
            aria-label="切换主题"
          >
            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
            {theme === 'dark' ? '白天模式' : '黑夜模式'}
          </button>

          {/* Logout Button */}
          <button
            onClick={handleLogout}
            className="admin-back-link"
          >
            <LogOut size={13} />
            退出登录
          </button>

          <Link href="/" className="admin-back-link">
            <Swords size={13} />
            返回 H5
          </Link>
        </div>
      </aside>

      {/* Main Content
          REPARK 6.0 (2026-08-23) P1 viewport lock:
          - .admin-main owns its own scrollbar (overflow-y-auto + height:100vh).
          - The activity CONFIG page is full-bleed (3-pane layout) → use plain
            `admin-main` (no padding). All other admin pages need the
            historic 32×40 padding → use `admin-main admin-main-padded`. */}
      <main
        className={
          pathname?.startsWith('/admin/activities/') &&
          pathname !== '/admin/activities' &&
          pathname.endsWith('/config')
            ? 'admin-main'
            : 'admin-main admin-main-padded'
        }
      >
        {children}
      </main>

      <ChangePasswordModal
        open={showChangePassword}
        theme={theme}
        onClose={() => setShowChangePassword(false)}
        onSuccess={() => {
          setShowChangePassword(false);
          // Clear local session and force re-login with the new password.
          clearAdminSession();
          localStorage.removeItem('admin_session');
          toast.success('密码已修改，1.5 秒后跳转登录页…');
          setTimeout(() => {
            window.location.href = '/admin/login';
          }, 1500);
        }}
      />
    </div>
  );
}

/* ── Change Password Modal ────────────────────────────────────────────────── */

function ChangePasswordModal({
  open,
  theme,
  onClose,
  onSuccess,
}: {
  open: boolean;
  theme: ThemeMode;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      // Reset state when closed
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowOld(false);
      setShowNew(false);
      setShowConfirm(false);
      setIsLoading(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (isLoading) return;
    if (!oldPassword || !newPassword || !confirmPassword) {
      toast.error('请填写所有字段');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('新密码至少 8 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    if (oldPassword === newPassword) {
      toast.error('新密码不能与旧密码相同');
      return;
    }

    setIsLoading(true);
    type ChangePwResp = {
      ok?: boolean;
      error?: { message?: string; code?: string };
      message?: string;
    };
    try {
      const res = await fetchWithTimeout('/api/admin/change-password', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          // Explicit Accept so any future content-negotiation is unambiguous.
          Accept: 'application/json',
        },
        body: JSON.stringify({ oldPassword, newPassword, confirmPassword }),
      });
      const data = (res.data ?? {}) as ChangePwResp;
      if (res.ok && data.ok) {
        onSuccess();
      } else if (res.status === 429) {
        toast.error(data?.error?.message ?? '尝试过于频繁，请稍后再试');
      } else if (res.status === 401) {
        // Distinguish business 401 (旧密码错) from session-expired 401.
        // The global 401 interceptor (admin layout) handles UNAUTHORIZED
        // by redirecting to /admin/login; we don't double-toast here.
        if (data?.error?.code === 'UNAUTHORIZED') {
          // Global interceptor will toast + redirect — do nothing else.
          return;
        }
        toast.error(data?.error?.message ?? '旧密码不正确');
      } else if (res.status === 400) {
        toast.error(data?.error?.message ?? '参数校验失败');
      } else {
        toast.error(data?.error?.message ?? `修改失败（${res.status}）`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '网络异常，请稍后再试');
    } finally {
      setIsLoading(false);
    }
  };

  // Theme-aware colors
  const overlay = theme === 'light' ? 'rgba(15, 23, 42, 0.45)' : 'rgba(0, 0, 0, 0.7)';
  const surface = theme === 'light' ? '#FFFFFF' : '#121215';
  const border = theme === 'light' ? '#E2E8F0' : '#27272A';
  const textStrong = theme === 'light' ? '#0F172A' : '#FAFAFA';
  const textMuted = theme === 'light' ? '#64748B' : '#A1A1AA';
  const inputBg = theme === 'light' ? '#FFFFFF' : '#09090B';
  const inputBorder = theme === 'light' ? '#CBD5E1' : '#3F3F46';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: overlay,
        backdropFilter: 'blur(4px)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: surface,
          border: `1px solid ${border}`,
          borderRadius: 12,
          padding: 24,
          width: 380,
          maxWidth: 'calc(100vw - 32px)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <KeyRound size={16} color={textStrong} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: textStrong }}>修改后台密码</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: textMuted,
              padding: 4,
              borderRadius: 6,
            }}
          >
            <X size={16} />
          </button>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: textMuted }}>
          修改后将被强制重新登录。HMAC 签名密钥保持不变，存量 cookie 在 24 小时内仍可使用。
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {/* hidden username to silence Chromium autofill warning */}
          <input type="text" name="username" value="admin" hidden readOnly tabIndex={-1} />

          {/* Old password */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: textStrong }}>旧密码</span>
            <div style={{ position: 'relative' }}>
              <input
                type={showOld ? 'text' : 'password'}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="current-password"
                style={{
                  width: '100%',
                  padding: '8px 36px 8px 10px',
                  fontSize: 13,
                  background: inputBg,
                  border: `1px solid ${inputBorder}`,
                  borderRadius: 8,
                  color: textStrong,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setShowOld((v) => !v)}
                aria-label={showOld ? '隐藏密码' : '显示密码'}
                style={{
                  position: 'absolute',
                  right: 6,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: textMuted,
                  padding: 4,
                }}
              >
                {showOld ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>

          {/* New password */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: textStrong }}>新密码（≥ 8 位）</span>
            <div style={{ position: 'relative' }}>
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="new-password"
                style={{
                  width: '100%',
                  padding: '8px 36px 8px 10px',
                  fontSize: 13,
                  background: inputBg,
                  border: `1px solid ${inputBorder}`,
                  borderRadius: 8,
                  color: textStrong,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? '隐藏密码' : '显示密码'}
                style={{
                  position: 'absolute',
                  right: 6,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: textMuted,
                  padding: 4,
                }}
              >
                {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>

          {/* Confirm password */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: textStrong }}>确认新密码</span>
            <div style={{ position: 'relative' }}>
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="new-password"
                style={{
                  width: '100%',
                  padding: '8px 36px 8px 10px',
                  fontSize: 13,
                  background: inputBg,
                  border: `1px solid ${inputBorder}`,
                  borderRadius: 8,
                  color: textStrong,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={showConfirm ? '隐藏密码' : '显示密码'}
                style={{
                  position: 'absolute',
                  right: 6,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: textMuted,
                  padding: 4,
                }}
              >
                {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: 13,
                background: 'transparent',
                border: `1px solid ${inputBorder}`,
                borderRadius: 8,
                color: textStrong,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.5 : 1,
              }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isLoading}
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: 13,
                fontWeight: 600,
                background: theme === 'light' ? '#0F172A' : '#FAFAFA',
                color: theme === 'light' ? '#FFFFFF' : '#09090B',
                border: 'none',
                borderRadius: 8,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                opacity: isLoading ? 0.7 : 1,
              }}
            >
              {isLoading && <Loader2 size={12} className="animate-spin" />}
              {isLoading ? '提交中…' : '确认修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
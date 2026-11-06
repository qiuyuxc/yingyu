import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Check, CircleAlert, X } from 'lucide-react';
import type { SiteInfo, User } from '../shared/types';
import { api, ApiError, errorMessage } from './api';

interface AuthState {
  user: User | null; site: SiteInfo | null; loading: boolean; error: string;
  setUser: (user: User | null) => void; refreshUser: () => Promise<void>;
  refreshSite: () => Promise<void>; retry: () => void; logout: () => Promise<void>;
}
const AuthContext = createContext<AuthState>(null!);
export const useAuth = () => useContext(AuthContext);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refreshUser = useCallback(async () => {
    try { setUser((await api<{ user: User }>('/api/auth/me')).user); }
    catch (err) { if (err instanceof ApiError && [401, 403].includes(err.status)) setUser(null); else throw err; }
  }, []);
  const refreshSite = useCallback(async () => { setSite(await api<SiteInfo>('/api/site')); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    Promise.all([
      api<SiteInfo>('/api/site', { signal: controller.signal }),
      api<{ user: User }>('/api/auth/me', { signal: controller.signal }).catch(err => {
        if (err instanceof ApiError && [401, 403].includes(err.status)) return { user: null };
        throw err;
      }),
    ]).then(([info, account]) => { if (!controller.signal.aborted) { setSite(info); setUser(account.user); } })
      .catch(err => { if (!controller.signal.aborted) setError(errorMessage(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const logout = useCallback(async () => { await api('/api/auth/logout', { method: 'POST' }); setUser(null); }, []);
  return <AuthContext value={{ user, site, loading, error, setUser, refreshUser, refreshSite, retry: () => setRevision(n => n + 1), logout }}>{children}</AuthContext>;
}

type Toast = { id: number; message: string; kind: 'success' | 'error' };
const ToastContext = createContext<(message: string, kind?: Toast['kind']) => void>(null!);
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(items => [...items.slice(-3), { id, message, kind }]);
    setTimeout(() => setToasts(items => items.filter(item => item.id !== id)), 5000);
  }, []);
  return <ToastContext value={toast}>{children}<div className="toasts" aria-live="polite" aria-atomic="false">{toasts.map(item => <div className={'toast ' + item.kind} key={item.id}>
    {item.kind === 'success' ? <Check size={15} /> : <CircleAlert size={15} />}<span>{item.message}</span>
    <button className="icon-button" aria-label="关闭提示" onClick={() => setToasts(items => items.filter(t => t.id !== item.id))}><X size={13} /></button>
  </div>)}</div></ToastContext>;
}

type Theme = 'light' | 'dark' | 'system';
export type Palette = 'mono' | 'green' | 'blue';
const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void; dark: boolean; palette: Palette; setPalette: (palette: Palette) => void }>(null!);
export const useTheme = () => useContext(ThemeContext);
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [palette, setPaletteState] = useState<Palette>(() => {
    try { const value = localStorage.getItem('yingyu-palette'); return value === 'mono' || value === 'blue' || value === 'green' ? value : 'mono'; } catch { return 'mono'; }
  });
  const [theme, setThemeState] = useState<Theme>(() => {
    try { const value = localStorage.getItem('yingyu-theme'); return value === 'dark' || value === 'light' ? value : 'system'; } catch { return 'system'; }
  });
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const listener = () => setSystemDark(media.matches);
    media.addEventListener('change', listener); return () => media.removeEventListener('change', listener);
  }, []);
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  useLayoutEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  useLayoutEffect(() => { document.documentElement.dataset.palette = palette; }, [palette]);
  const setTheme = (value: Theme) => { setThemeState(value); try { localStorage.setItem('yingyu-theme', value); } catch { /* Private browser storage may be unavailable. */ } };
  const setPalette = (value: Palette) => { setPaletteState(value); try { localStorage.setItem('yingyu-palette', value); } catch { /* Private browser storage may be unavailable. */ } };
  return <ThemeContext value={{ theme, setTheme, dark, palette, setPalette }}>{children}</ThemeContext>;
}

import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CloudUpload, FolderOpen, Heart, Images, LayoutDashboard, LogOut, Menu, Moon, Mail, Settings, ShieldCheck, SlidersHorizontal, Sparkles, Star, Sun, Users, HardDrive, ClipboardCheck, Image, X } from 'lucide-react';
import { useAuth, useTheme, useToast } from './context';
import { errorMessage, formatBytes } from './api';
import { Button, ErrorState, Loading, Logo } from './components/ui';
import { Home } from './pages/Home';
import { AuthPage } from './pages/Auth';
import { Gallery, AlbumsPage } from './pages/Gallery';
import { UploadPage } from './pages/Upload';
import { AccountPage, QuotaPage } from './pages/Account';
import { AdminOverviewPage, AdminUsersPage, AdminRequestsPage, AdminImagesPage, AdminSettingsPage } from './pages/Admin';
import { StoragePage } from './pages/Storage';
import { AdminMailPage } from './pages/AdminMail';
import { EmailAccountPage } from './pages/EmailAccount';

function Guard({ admin = false }: { admin?: boolean }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to={'/login?next=' + encodeURIComponent(location.pathname + location.search)} replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/app" replace />;
  return <Outlet />;
}

const userLinks = [
  { to: '/app', label: '我的图片', icon: Images, end: true },
  { to: '/app/upload', label: '上传图片', icon: CloudUpload },
  { to: '/app/albums', label: '我的相册', icon: FolderOpen },
  { to: '/app/starred', label: '收藏夹', icon: Star },
];
const adminLinks = [
  { to: '/admin', label: '站点概览', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: '用户管理', icon: Users },
  { to: '/admin/requests', label: '扩容申请', icon: ClipboardCheck },
  { to: '/admin/storage', label: '存储管理', icon: HardDrive },
  { to: '/admin/images', label: '图片管理', icon: Image },
  { to: '/admin/settings', label: '站点设置', icon: SlidersHorizontal },
  { to: '/admin/mail', label: '邮件设置', icon: Mail },
];

function Shell({ admin = false }: { admin?: boolean }) {
  const { user, logout } = useAuth();
  const { dark, setTheme } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  if (!user) return null;
  const links = admin ? adminLinks : userLinks;
  const current = [...links, { to: '/app/quota', label: '空间与配额' }, { to: '/app/settings', label: '账户设置' }].find(item => item.to === location.pathname);
  const signOut = async () => {
    setLoggingOut(true);
    try { await logout(); navigate('/'); } catch (err) { toast(errorMessage(err), 'error'); } finally { setLoggingOut(false); }
  };
  const percent = user.quotaBytes ? Math.min(100, (user.usedBytes + user.reservedBytes) / user.quotaBytes * 100) : 0;
  return <div className="workspace">
    <button className={'sidebar-scrim ' + (menuOpen ? 'visible' : '')} aria-label="关闭导航" onClick={() => setMenuOpen(false)} tabIndex={menuOpen ? 0 : -1} />
    <aside id="workspace-navigation" className={'sidebar glass ' + (menuOpen ? 'expanded' : '')}>
      <div className="sidebar-brand"><Link to="/" aria-label="映屿首页"><Logo /></Link><button className="icon-button mobile-only" aria-label="关闭导航" onClick={() => setMenuOpen(false)}><X size={17} /></button></div>

      <nav aria-label={admin ? '后台导航' : '工作台导航'}>
        <span className="nav-section-label">{admin ? '站点管理' : '资源库'}</span>
        {links.map(({ to, label, icon: Icon, ...props }) => <NavLink {...props} key={to} to={to} className={({ isActive }) => 'nav-item ' + (isActive ? 'active' : '')}><Icon size={16} strokeWidth={1.7} /><span>{label}</span>{to === '/app' && <small>{user.imageCount}</small>}</NavLink>)}
        {!admin && <><span className="nav-section-label second">个人空间</span><NavLink to="/app/quota" className={({ isActive }) => 'nav-item ' + (isActive ? 'active' : '')}><HardDrive size={16} /><span>空间与配额</span></NavLink><NavLink to="/app/settings" className={({ isActive }) => 'nav-item ' + (isActive ? 'active' : '')}><Settings size={16} /><span>账户设置</span></NavLink></>}
        {user.role === 'admin' && <><span className="nav-divider" /><Link className="nav-item nav-switch" to={admin ? '/app' : '/admin'}>{admin ? <Images size={16} /> : <ShieldCheck size={16} />}<span>{admin ? '返回我的空间' : '管理后台'}</span><ArrowRight size={13} /></Link></>}
      </nav>
      <div className="sidebar-bottom">
        {!admin && <Link to="/app/quota" className="sidebar-storage"><div><span>我的存储空间</span><span>{percent.toFixed(0)}%</span></div><div className="progress-track"><span style={{ width: percent + '%' }} /></div><p><strong>{formatBytes(user.usedBytes)}</strong> / {formatBytes(user.quotaBytes)}</p><span className="storage-more">按需申请更多空间 <ArrowRight size={12} /></span></Link>}
        <div className="sidebar-account"><Link to="/app/settings" className="account-link"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{admin ? '站点管理员' : user.tier}</small></span></Link><Button variant="ghost" className="icon-button" aria-label="退出登录" busy={loggingOut} onClick={signOut}>{!loggingOut && <LogOut size={15} />}</Button></div>
      </div>
    </aside>
    <div className="workspace-body"><header className="workspace-topbar"><div className="topbar-left"><button className="icon-button mobile-only" aria-label="打开导航" aria-controls="workspace-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={18} /></button><span>{admin ? '管理后台' : '个人工作台'}</span><span className="breadcrumb-separator">/</span><strong>{current?.label || '我的相册'}</strong></div><div className="topbar-actions"><span className="today">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</span><button className="icon-button" aria-label={dark ? '切换浅色外观' : '切换深色外观'} onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button><Link to="/" className="icon-button" aria-label="返回官网"><Sparkles size={16} /></Link><span className="avatar avatar-small">{user.name.slice(0, 1).toUpperCase()}</span></div></header><main className="workspace-main"><Outlet /></main><footer className="workspace-footer"><span>映屿</span><span>图片存储与分享</span></footer></div>
  </div>;
}

function NotFound() { return <div className="not-found glass"><Logo /><h1>这座小岛还没有被发现</h1><p>你访问的页面不存在，回到首页继续探索吧。</p><Link to="/" className="button primary"><ArrowLeft size={14} />返回首页</Link></div>; }

export function App() {
  const { loading, error, retry, site } = useAuth();
  const location = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  useEffect(() => { document.title = (site?.settings.siteName || '映屿') + ' · 让图片，自由流动'; }, [site?.settings.siteName]);
  return <><div className="ambient" aria-hidden="true"><span /><span /><span /></div>{loading ? <Loading full /> : error ? <div className="startup-error"><ErrorState error={error} retry={retry} /></div> : <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/login" element={<AuthPage />} />
    <Route path="/register" element={<AuthPage register />} />
    <Route path="/forgot-password" element={<EmailAccountPage key="forgot" mode="forgot" />} />
    <Route path="/reset-password" element={<EmailAccountPage key="reset" mode="reset" />} />
    <Route path="/verify-email" element={<EmailAccountPage key="verify" mode="verify" />} />
    <Route element={<Guard />}><Route element={<Shell />}>
      <Route path="/app" element={<Gallery />} />
      <Route path="/app/starred" element={<Gallery starred />} />
      <Route path="/app/upload" element={<UploadPage />} />
      <Route path="/app/albums" element={<AlbumsPage />} />
      <Route path="/app/albums/:albumId" element={<Gallery />} />
      <Route path="/app/quota" element={<QuotaPage />} />
      <Route path="/app/settings" element={<AccountPage />} />
    </Route></Route>
    <Route element={<Guard admin />}><Route element={<Shell admin />}>
      <Route path="/admin" element={<AdminOverviewPage />} />
      <Route path="/admin/users" element={<AdminUsersPage />} />
      <Route path="/admin/requests" element={<AdminRequestsPage />} />
      <Route path="/admin/storage" element={<StoragePage />} />
      <Route path="/admin/images" element={<AdminImagesPage />} />
      <Route path="/admin/settings" element={<AdminSettingsPage />} />
      <Route path="/admin/mail" element={<AdminMailPage />} />
    </Route></Route>
    <Route path="*" element={<NotFound />} />
  </Routes>}</>;
}

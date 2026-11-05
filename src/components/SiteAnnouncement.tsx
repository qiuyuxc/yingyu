import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, X } from 'lucide-react';
import { useAuth } from '../context';

function AnnouncementBanner({ message, userId }: { message: string; userId: string }) {
  const key = `yingyu-banner-dismissed:${userId}`;
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(key) === message; } catch { return false; }
  });
  if (dismissed) return null;
  return <aside className="site-announcement" aria-label="站点公告">
    <Megaphone size={14} className="announcement-icon" />
    <p>{message}</p>
    <button type="button" className="icon-button" aria-label="关闭公告" onClick={() => {
      try { localStorage.setItem(key, message); } catch {}
      setDismissed(true);
    }}><X size={14} /></button>
  </aside>;
}

export function SiteAnnouncement() {
  const { site, user } = useAuth();
  const [expiryDismissed,setExpiryDismissed]=useState(false);
  const [time,setTime]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setTime(Date.now()),60000);return()=>clearInterval(timer);},[]);
  const message = site?.settings.announcement;
  const remaining=user?.avatarLibraryExpiresAt?Date.parse(user.avatarLibraryExpiresAt)-time:Infinity;
  const expiring=!user?.avatarLibraryEnabled&&Boolean(user?.avatarHistoryCount)&&remaining<=3*86400_000;

  return <>{expiring&&!expiryDismissed&&<aside className="site-announcement avatar-expiry-notice" aria-label="头像库到期提醒"><Megaphone size={14} /><p>{remaining>0?`头像库的 ${user!.avatarHistoryCount} 个历史头像将在 ${Math.max(1,Math.ceil(remaining/86400_000))} 天内删除，当前头像不受影响。`:'历史头像已到期，系统正在清理并归还配额。'}<Link to="/app/settings#avatar-settings">管理头像库</Link></p><button type="button" className="icon-button" aria-label="关闭头像库提醒" onClick={()=>setExpiryDismissed(true)}><X size={14} /></button></aside>}{user&&message?.trim()&&<AnnouncementBanner key={user.id + ':' + message} message={message} userId={user.id} />}</>;
}

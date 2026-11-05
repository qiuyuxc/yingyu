import { useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { useAuth } from '../context';

export function SiteAnnouncement() {
  const { site } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const message = site?.settings.announcement;
  if (dismissed || !message?.trim()) return null;

  return <aside className="site-announcement" aria-label="站点公告">
    <Megaphone size={14} className="announcement-icon" />
    <p>{message}</p>
    <button type="button" className="icon-button" aria-label="关闭公告" onClick={() => setDismissed(true)}><X size={14} /></button>
  </aside>;
}

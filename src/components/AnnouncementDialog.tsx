import { useState } from 'react';
import { Megaphone } from 'lucide-react';
import type { Announcement } from '../../shared/types';
import { useResource, formatDate } from '../api';
import { Button, Dialog } from './ui';

export function AnnouncementCard({ open, title, content, date, onClose, onDismiss }: { open: boolean; title: string; content: string; date?: string | null; onClose: () => void; onDismiss?: () => void }) {
  return <Dialog open={open} onClose={onClose} title={title || '站点公告'} wide>
    <div className="login-announcement-label"><Megaphone size={16} /><span>站点公告{date ? ' · ' + formatDate(date, true) : ''}</span></div>
    <div className="login-announcement-content">{content}</div>
    <div className="dialog-actions announcement-actions">{onDismiss && <Button type="button" onClick={onDismiss}>不再弹出</Button>}<Button type="button" variant="primary" onClick={onClose}>我知道了</Button></div>
  </Dialog>;
}

function PublishedAnnouncement({ announcement, userId }: { announcement: Announcement; userId: string }) {
  const key = `yingyu-announcement-dismissed:${userId}:${announcement.id}`;
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) !== String(announcement.revision); } catch { return true; }
  });
  return <AnnouncementCard open={open} title={announcement.title} content={announcement.content} date={announcement.publishedAt} onClose={() => setOpen(false)} onDismiss={() => {
    try { localStorage.setItem(key, String(announcement.revision)); } catch {}
    setOpen(false);
  }} />;
}

// Mounted once while the authenticated workspace is active, rather than on each page.
export function PostLoginAnnouncement({ userId }: { userId: string }) {
  const resource = useResource<{ announcement: Announcement | null }>('/api/announcements/popup');
  const announcement = resource.data?.announcement;
  if (!announcement) return null;
  return <PublishedAnnouncement key={announcement.id + ':' + announcement.revision} announcement={announcement} userId={userId} />;
}

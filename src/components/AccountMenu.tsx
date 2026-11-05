import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut, Settings } from 'lucide-react';
import type { User } from '../../shared/types';
import { Avatar } from './Avatar';
import { Button } from './ui';

export function AccountMenu({ user, busy, onLogout }: { user: User; busy: boolean; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const location = useLocation();
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const keyboard = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!open) { setOpen(true); return; }
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') || [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  };
  return <div ref={root} className="account-menu" onKeyDown={keyboard} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" className="account-menu-trigger" aria-label="账户菜单" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}><Avatar name={user.name} url={user.avatarUrl} className="avatar-small" /><ChevronDown size={12} /></button>
    {open && <div id={id} role="menu" aria-label="账户操作" className="account-menu-panel glass"><div className="account-menu-identity"><strong>{user.name}</strong><small>{user.email}</small></div><Link to="/app/settings" role="menuitem" tabIndex={-1}><Settings size={14} />账户设置</Link><Button role="menuitem" tabIndex={-1} variant="ghost" busy={busy} onClick={onLogout}><LogOut size={14} />退出登录</Button></div>}
  </div>;
}

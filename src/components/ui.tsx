import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, X } from 'lucide-react';

export function Logo({ small = false }: { small?: boolean }) {
  return <span className={'brand ' + (small ? 'brand-small' : '')}><span className="brand-symbol"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="7" y="5" width="20" height="22" rx="6" fill="currentColor" opacity=".25" transform="rotate(10 17 16)" />
    <rect x="4" y="7" width="20" height="21" rx="6" fill="currentColor" />
    <path d="m8 22 5-6 4 4 3-3" stroke="var(--on-accent, #fff)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="17" cy="12" r="2" fill="var(--on-accent, #fff)" />
  </svg></span><span><strong>映屿</strong><small>YINGYU</small></span></span>;
}
export function Button({ children, busy, variant = 'secondary', className = '', disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return <button {...props} disabled={disabled || busy} className={'button ' + variant + ' ' + className}>{busy && <LoaderCircle className="spin" size={14} />}{children}</button>;
}
export function Dialog({ open, onClose, title, subtitle, children, wide = false }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { const dialog = ref.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); if (!open && dialog.open) dialog.close(); }, [open]);
  return <dialog ref={ref} className={'dialog glass ' + (wide ? 'dialog-wide' : '')} aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-content"><div className="dialog-heading"><div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="icon-button" aria-label="关闭对话框" onClick={onClose}><X size={17} /></button></div>{children}</div>
  </dialog>;
}
export function Confirm({ open, onClose, onConfirm, title, children, busy }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; children: ReactNode; busy: boolean }) {
  return <Dialog open={open} onClose={busy ? () => {} : onClose} title={title}><div className="confirm-message">{children}</div><div className="dialog-actions"><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="danger" busy={busy} onClick={onConfirm}>确认删除</Button></div></Dialog>;
}
export function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={'switch ' + (checked ? 'on' : '')} onClick={() => onChange(!checked)}><span /></button>;
}
export function Loading({ full = false }: { full?: boolean }) { return <div className={'loading ' + (full ? 'loading-full' : '')}><LoaderCircle size={22} className="spin" /><span>正在加载…</span></div>; }
export function ErrorState({ error, retry }: { error: string; retry: () => void }) { return <div className="error-state glass"><CircleAlert size={24} /><p>{error}</p><Button onClick={retry}>重新加载</Button></div>; }
export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function PageHeading({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="page-heading"><h1>{title}</h1>{action}</div>;
}
export function Pagination({ page, total, size = 30, onPage }: { page: number; total: number; size?: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  return <div className="pagination"><span>共 {total} 项 · 第 {page} / {pages} 页</span><div><Button aria-label="上一页" disabled={page <= 1} onClick={() => onPage(page - 1)}><ArrowLeft size={13} /></Button><Button aria-label="下一页" disabled={page >= pages} onClick={() => onPage(page + 1)}><ArrowRight size={13} /></Button></div></div>;
}

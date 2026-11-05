import { useState, type FormEvent } from 'react';
import { Search, Settings2, Users } from 'lucide-react';
import { GiB, type User } from '../../shared/types';
import { api, errorMessage, formatBytes, formatDate, useDebounced, useResource } from '../api';
import { useAuth, useToast } from '../context';
import { Button, Dialog, EmptyState, ErrorState, Loading, PageHeading, Pagination } from '../components/ui';

export function AdminUsersPage() {
  const { user: actor, refreshUser } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [page, setPage] = useState(1);
  const resource = useResource<{ users: User[]; total: number }>('/api/admin/users?' + new URLSearchParams({ page: String(page), search: debounced }));
  const [target, setTarget] = useState<User | null>(null);
  const [quota, setQuota] = useState(1);
  const [tier, setTier] = useState('');
  const [status, setStatus] = useState<User['status']>('active');
  const [role, setRole] = useState<User['role']>('user');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const edit = (user: User) => { setTarget(user); setQuota(user.quotaBytes / GiB); setTier(user.tier); setStatus(user.status); setRole(user.role); setReason('管理员调配'); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!target) return; setBusy(true);
    try { await api('/api/admin/users/' + target.id, { method: 'PATCH', body: { quotaBytes: Math.round(quota * GiB), tier, status, role, reason } }); setTarget(null); resource.refresh(); await refreshUser(); toast('用户配额与设置已更新'); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  return <><PageHeading title="用户管理" /><section className="admin-table-panel glass"><div className="table-toolbar"><div className="search-field"><Search size={14} /><input aria-label="搜索用户" placeholder="搜索用户名或邮箱…" maxLength={100} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></div><span>{resource.data?.total ?? '—'} 位用户</span></div>{resource.loading ? <Loading /> : resource.error ? <ErrorState error={resource.error} retry={resource.refresh} /> : !resource.data?.users.length ? <EmptyState icon={<Users size={25} />} title="没有找到用户" description="试试其他名称或邮箱。" /> : <div className="table-scroll"><table className="data-table users-table"><thead><tr><th>用户</th><th>角色 / 状态</th><th>空间配额</th><th>图片</th><th>注册时间</th><th>管理</th></tr></thead><tbody>{resource.data.users.map(user => <tr key={user.id}><td><div className="table-user"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}{user.id === actor!.id && <small>（我）</small>}</strong><span>{user.email}</span></div></div></td><td><span className={'badge ' + (user.role === 'admin' ? 'lilac-badge' : 'neutral')}>{user.role === 'admin' ? '管理员' : '用户'}</span><span className={'table-status ' + user.status}>{user.status === 'active' ? '正常' : '已停用'}</span></td><td><div className="user-quota"><span>{formatBytes(user.usedBytes)} <small>/ {formatBytes(user.quotaBytes)}</small></span><div className="progress-track"><span style={{ width: (user.quotaBytes ? Math.min(100, (user.usedBytes + user.reservedBytes) / user.quotaBytes * 100) : 0) + '%' }} /></div><small>{user.tier}{user.reservedBytes ? ' · 预留 ' + formatBytes(user.reservedBytes) : ''}</small></div></td><td>{user.imageCount}</td><td>{formatDate(user.createdAt)}</td><td><Button onClick={() => edit(user)} aria-label={'管理用户 ' + user.name}><Settings2 size={12} />调配</Button></td></tr>)}</tbody></table></div>}<Pagination page={page} total={resource.data?.total || 0} onPage={setPage} /></section>
    <Dialog open={Boolean(target)} onClose={busy ? () => {} : () => setTarget(null)} title={'管理用户 · ' + (target?.name || '')} subtitle={target?.email}><form className="form-stack" onSubmit={save}><label>存储总配额<div className="input-suffix"><input type="number" step="any" required min={target ? (target.usedBytes + target.reservedBytes) / GiB : 0} max={102400} value={quota} onChange={event => setQuota(Number(event.target.value))} /><span>GB</span></div><small>最低可分配 {formatBytes((target?.usedBytes || 0) + (target?.reservedBytes || 0))}，包含已用和预留空间。</small></label><label>额度标签<input value={tier} onChange={event => setTier(event.target.value)} required maxLength={40} placeholder="例如：创作者额度" /></label><div className="form-columns"><label>账户状态<select value={status} disabled={target?.id === actor!.id} onChange={event => setStatus(event.target.value as User['status'])}><option value="active">正常</option><option value="suspended">停用</option></select></label><label>账户角色<select value={role} disabled={target?.id === actor!.id} onChange={event => setRole(event.target.value as User['role'])}><option value="user">普通用户</option><option value="admin">管理员</option></select></label></div><label>调配说明<textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={500} required /></label><div className="dialog-actions"><Button type="button" disabled={busy} onClick={() => setTarget(null)}>取消</Button><Button type="submit" variant="primary" busy={busy}>保存调配</Button></div></form></Dialog>
  </>;
}

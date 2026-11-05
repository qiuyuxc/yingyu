import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, ClipboardCheck, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { GiB, type QuotaRequest } from '../../shared/types';
import { api, errorMessage, formatBytes, formatDate, useResource } from '../api';
import { useToast } from '../context';
import { Button, Dialog, EmptyState, ErrorState, Loading, PageHeading } from '../components/ui';
import { requestStatus, statusColor } from './Account';

export function AdminRequestsPage() {
  const toast = useToast();
  const [filter, setFilter] = useState('pending');
  const resource = useResource<{ requests: QuotaRequest[] }>('/api/admin/quota-requests?status=' + filter);
  const [target, setTarget] = useState<QuotaRequest | null>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [quota, setQuota] = useState(1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const review = (request: QuotaRequest, status: typeof decision) => { setTarget(request); setDecision(status); setQuota(Math.max(request.requestedBytes, request.currentQuota) / GiB); setNote(''); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!target) return; setBusy(true);
    try { await api('/api/admin/quota-requests/' + target.id, { method: 'PATCH', body: { status: decision, adminNote: note, ...(decision === 'approved' ? { quotaBytes: Math.round(quota * GiB) } : {}) } }); setTarget(null); resource.refresh(); toast(decision === 'approved' ? '申请已通过，新配额已生效' : '申请已退回'); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  return <><PageHeading title="扩容申请" action={<Button onClick={resource.refresh}><RefreshCw size={13} />刷新申请</Button>} /><div className="requests-toolbar"><div className="segmented">{['pending', 'approved', 'rejected', 'all'].map(value => <button key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{value === 'all' ? '全部申请' : requestStatus[value as keyof typeof requestStatus]}</button>)}</div><span>{resource.data?.requests.length ?? '—'} 条记录</span></div>
    {resource.loading ? <Loading /> : resource.error ? <ErrorState error={resource.error} retry={resource.refresh} /> : !resource.data?.requests.length ? <div className="glass"><EmptyState icon={<ClipboardCheck size={28} />} title={filter === 'pending' ? '暂无待处理申请' : '这里还没有申请记录'} description="新的扩容申请会出现在这里。" /></div> : <div className="admin-request-grid">{resource.data.requests.map(request => <article className="admin-request-card glass" key={request.id}><div className="request-user"><span className="avatar">{request.userName.slice(0, 1).toUpperCase()}</span><div><strong>{request.userName}</strong><small>{request.userEmail}</small></div><span className={'badge ' + statusColor[request.status]}>{requestStatus[request.status]}</span></div><div className="request-quota-comparison"><div><span>当前总配额</span><strong>{formatBytes(request.currentQuota)}</strong></div><ArrowRight size={17} /><div><span>申请总配额</span><strong>{formatBytes(request.requestedBytes)}</strong></div></div><span className="field-caption">用途说明</span><p className="request-reason">{request.reason}</p>{request.adminNote && <div className="review-note"><ShieldCheck size={12} />{request.adminNote}</div>}<div className="request-card-footer"><time dateTime={request.createdAt}>{formatDate(request.createdAt, true)}</time>{request.status === 'pending' ? <div><Button onClick={() => review(request, 'rejected')}><X size={12} />退回</Button><Button variant="primary" onClick={() => review(request, 'approved')}><Check size={12} />通过</Button></div> : <small>审核于 {formatDate(request.reviewedAt!, true)}</small>}</div></article>)}</div>}
    <Dialog open={Boolean(target)} onClose={busy ? () => {} : () => setTarget(null)} title={'审核扩容 · ' + (target?.userName || '')} subtitle={'申请总额度 ' + formatBytes(target?.requestedBytes || 0)}><form className="form-stack" onSubmit={submit}><div className="segmented decision-control"><button type="button" className={decision === 'approved' ? 'selected' : ''} onClick={() => setDecision('approved')}><Check size={13} />批准扩容</button><button type="button" className={decision === 'rejected' ? 'selected' : ''} onClick={() => setDecision('rejected')}><X size={13} />退回申请</button></div>{decision === 'approved' && <label>实际分配的总额度<div className="input-suffix"><input type="number" required step="any" min={(target?.currentQuota || 0) / GiB} max={102400} value={quota} onChange={event => setQuota(Number(event.target.value))} /><span>GB</span></div><small>管理员可按实际需要调整，不能低于当前配额。</small></label>}<label>审核意见<textarea value={note} onChange={event => setNote(event.target.value)} rows={4} maxLength={500} placeholder={decision === 'approved' ? '例如：已为你的摄影作品分配更多空间。' : '说明退回原因，方便用户调整申请。'} /></label><div className="dialog-actions"><Button type="button" disabled={busy} onClick={() => setTarget(null)}>取消</Button><Button type="submit" variant={decision === 'approved' ? 'primary' : 'secondary'} busy={busy}>{decision === 'approved' ? '确认分配' : '确认退回'}</Button></div></form></Dialog>
  </>;
}

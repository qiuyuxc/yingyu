import { useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, HardDrive, KeyRound, Leaf, LockKeyhole, Plus, RefreshCw, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { GiB, type ApiToken, type QuotaRequest, type User } from '../../shared/types';
import { api, copyText, errorMessage, formatBytes, formatDate, useResource } from '../api';
import { useAuth, useToast } from '../context';
import { Button, Confirm, Dialog, EmptyState, ErrorState, Loading, PageHeading } from '../components/ui';
import { AppearanceSettings } from '../components/AppearanceSettings';

export const requestStatus = { pending: '待审核', approved: '已通过', rejected: '未通过' };
export const statusColor = { pending: 'amber', approved: 'green', rejected: 'neutral' };

export function QuotaPage() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const resource = useResource<{ requests: QuotaRequest[] }>('/api/quota/requests');
  const [space, setSpace] = useState(Math.max(2, Math.ceil(user!.quotaBytes / GiB * 2)));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void refreshUser().catch(err => toast(errorMessage(err), 'error')); }, [refreshUser, toast]);
  const pending = resource.data?.requests.find(request => request.status === 'pending');
  const percent = user!.quotaBytes ? Math.min(100, (user!.usedBytes + user!.reservedBytes) / user!.quotaBytes * 100) : 0;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await api('/api/quota/requests', { method: 'POST', body: { requestedBytes: Math.round(space * GiB), reason } }); setReason(''); resource.refresh(); toast('扩容申请已提交，请等待管理员审核'); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  return <><PageHeading title="空间与配额" action={<Button onClick={() => { resource.refresh(); void refreshUser().catch(err => toast(errorMessage(err), 'error')); }}><RefreshCw size={13} />刷新</Button>} />
    <div className="quota-layout"><div><section className="quota-summary glass"><div className="quota-summary-main"><div><h2>{formatBytes(user!.quotaBytes)}</h2><span className="badge green">{user!.tier}</span><p>免费使用，管理员按需分配。</p></div><div className="quota-ring" style={{ background: 'conic-gradient(var(--accent) ' + percent + '%, var(--soft-line) 0)' }}><div><strong>{percent.toFixed(1)}<small>%</small></strong><span>空间占用</span></div></div></div><div className="quota-metrics"><div><span>已用空间</span><strong>{formatBytes(user!.usedBytes)}</strong></div><div><span>可用空间</span><strong>{formatBytes(Math.max(0, user!.quotaBytes - user!.usedBytes - user!.reservedBytes))}</strong></div><div><span>图片数量</span><strong>{user!.imageCount}<small> 张</small></strong></div></div>{user!.reservedBytes > 0 && <p className="inline-notice">正在处理的上传已预留 {formatBytes(user!.reservedBytes)} 空间。</p>}</section>
    <section className="request-history glass"><div className="panel-heading"><div><h3>我的扩容申请</h3></div></div>{resource.loading ? <Loading /> : resource.error ? <ErrorState error={resource.error} retry={resource.refresh} /> : !resource.data?.requests.length ? <EmptyState icon={<HardDrive size={23} />} title="还没有扩容申请" description="需要更多空间时，可填写扩容申请。" /> : <div className="request-list">{resource.data.requests.map(request => <article key={request.id}><div><strong>申请 {formatBytes(request.requestedBytes)} 总空间</strong><span className={'badge ' + statusColor[request.status]}>{requestStatus[request.status]}</span></div><p>{request.reason}</p>{request.adminNote && <div className="review-note"><ShieldCheck size={12} /><span>管理员回复：{request.adminNote}</span></div>}<small>提交于 {formatDate(request.createdAt, true)}{request.reviewedAt ? ' · 审核于 ' + formatDate(request.reviewedAt, true) : ''}</small></article>)}</div>}</section></div>
    <section className="quota-application glass"><span className="application-icon"><Leaf size={22} /></span><h2>申请扩容</h2><p>告诉我们你的用途，管理员会根据实际情况分配配额。</p>{pending ? <div className="pending-application"><span className="badge amber">申请审核中</span><strong>{formatBytes(pending.requestedBytes)}</strong><p>你的申请已经送达，请耐心等待。审核结果会显示在申请记录中。</p></div> : <form className="form-stack" onSubmit={submit}><label>希望获得的总空间<div className="input-suffix"><input type="number" required min={0.1} max={102400} step="0.1" value={space} onChange={event => setSpace(Number(event.target.value))} /><span>GB</span></div><small>填写扩容后的总额度，应高于当前 {formatBytes(user!.quotaBytes)}。</small></label><div className="space-presets">{[2, 5, 10, 20].filter(value => value * GiB > user!.quotaBytes).map(value => <button type="button" key={value} className={space === value ? 'selected' : ''} onClick={() => setSpace(value)}>{value} GB</button>)}</div><label>用途说明<textarea required minLength={5} maxLength={500} rows={5} placeholder="例如：用于个人博客与摄影作品的长期存放…" value={reason} onChange={event => setReason(event.target.value)} /></label><Button type="submit" variant="primary" className="full-width" busy={busy} disabled={resource.loading || Boolean(resource.error)}><Send size={13} />提交扩容申请</Button></form>}<div className="application-footnote"><Check size={12} />免费扩容，无需在线支付</div></section></div>
  </>;
}

export function AccountPage() {
  const { user, setUser, refreshUser } = useAuth();
  const toast = useToast();
  const resource = useResource<{ tokens: ApiToken[] }>('/api/account/tokens');
  const [name, setName] = useState(user!.name);
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [tokenName, setTokenName] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [token, setToken] = useState('');
  const [deleting, setDeleting] = useState<ApiToken | null>(null);
  const profile = async (event: FormEvent) => {
    event.preventDefault(); setProfileBusy(true);
    try { setUser((await api<{ user: User }>('/api/account/profile', { method: 'PATCH', body: { name } })).user); toast('名字已更新'); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setProfileBusy(false); }
  };
  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) { toast('两次输入的新密码不一致', 'error'); return; }
    setPasswordBusy(true);
    try { await api('/api/account/password', { method: 'PATCH', body: { currentPassword, password } }); setCurrentPassword(''); setPassword(''); setConfirmation(''); resource.refresh(); await refreshUser(); toast('密码已更新，其他会话和访问令牌已撤销'); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setPasswordBusy(false); }
  };
  const createToken = async (event: FormEvent) => {
    event.preventDefault(); setTokenBusy(true);
    try { const result = await api<{ token: string }>('/api/account/tokens', { method: 'POST', body: { name: tokenName } }); setToken(result.token); setTokenName(''); resource.refresh(); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setTokenBusy(false); }
  };
  const revoke = async () => {
    if (!deleting) return; setTokenBusy(true);
    try { await api('/api/account/tokens/' + deleting.id, { method: 'DELETE' }); setDeleting(null); resource.refresh(); toast('访问令牌已撤销'); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setTokenBusy(false); }
  };
  return <><PageHeading title="账户设置" /><div className="account-layout"><section className="settings-panel glass"><div className="panel-heading"><h3>个人资料</h3></div><div className="profile-header"><span className="avatar avatar-large">{user!.name.slice(0, 1).toUpperCase()}</span><div><strong>{user!.name}</strong><p>{user!.email}</p><span className="badge green">{user!.role === 'admin' ? '站点管理员' : user!.tier}</span></div></div><form className="form-stack" onSubmit={profile}><label>显示名称<input required maxLength={40} value={name} onChange={event => setName(event.target.value)} autoComplete="nickname" /></label><label>邮箱地址<input value={user!.email} disabled /></label><Button variant="primary" type="submit" busy={profileBusy}>保存资料</Button></form><AppearanceSettings /></section>
    <section className="settings-panel glass"><div className="panel-heading"><h3><LockKeyhole size={15} />账户安全</h3></div><p className="panel-description">更新密码后，其他设备的登录状态和所有访问令牌会被撤销。</p><form className="form-stack" onSubmit={changePassword}><label>当前密码<input type="password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" maxLength={128} /></label><label>新密码<input type="password" required minLength={10} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder="至少 10 个字符" autoComplete="new-password" /></label><label>再次输入新密码<input type="password" required minLength={10} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" /></label><Button type="submit" busy={passwordBusy}>更新密码</Button></form></section>
    <section className="settings-panel glass token-panel"><div className="panel-heading"><div><h3><KeyRound size={15} />API 访问令牌</h3><p>用于脚本或第三方工具上传图片，仅允许访问个人资源。</p></div></div><form className="token-create" onSubmit={createToken}><input aria-label="令牌名称" required maxLength={40} value={tokenName} onChange={event => setTokenName(event.target.value)} placeholder="令牌名称，例如：我的博客" /><Button type="submit" busy={tokenBusy}><Plus size={13} />创建令牌</Button></form>{resource.loading ? <Loading /> : resource.error ? <ErrorState error={resource.error} retry={resource.refresh} /> : resource.data?.tokens.length ? <div className="token-list">{resource.data.tokens.map(entry => <div key={entry.id}><span className="token-icon"><KeyRound size={15} /></span><div><strong>{entry.name}</strong><code>{entry.prefix}…</code><small>创建于 {formatDate(entry.createdAt)} · {entry.lastUsedAt ? '最近使用 ' + formatDate(entry.lastUsedAt, true) : '尚未使用'}</small></div><Button variant="ghost" aria-label={'撤销令牌 ' + entry.name} onClick={() => setDeleting(entry)}><Trash2 size={14} /></Button></div>)}</div> : <p className="token-empty">还没有访问令牌，需要使用 API 时再创建即可。</p>}<details className="api-help"><summary>如何使用 API 上传图片？</summary><p>向 POST /api/images 发送 multipart/form-data，使用 file 字段传入图片，并在请求头中设置 Authorization: Bearer 你的访问令牌。</p><p>可选字段：visibility（public / private）、albumId（相册 ID）。</p></details></section></div>
    <Dialog open={Boolean(token)} onClose={() => setToken('')} title="访问令牌已创建" subtitle="完整令牌仅显示这一次，请复制并妥善保存。"><div className="token-reveal"><KeyRound size={23} /><textarea readOnly value={token} aria-label="新创建的访问令牌" rows={3} /><Button className="full-width" onClick={async () => { try { await copyText(token); toast('令牌已复制'); } catch (err) { toast(errorMessage(err), 'error'); } }}><Copy size={13} />复制令牌</Button></div><div className="dialog-actions"><Button variant="primary" onClick={() => setToken('')}>已保存，关闭</Button></div></Dialog>
    <Confirm open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={() => void revoke()} busy={tokenBusy} title="撤销这个访问令牌？">使用此令牌的脚本或工具将无法继续访问你的账号资源。</Confirm>
  </>;
}

import { useEffect, useId, useState, type FormEvent } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import type { EmailChangeStatus, PendingEmailChange, User } from '../../shared/types';
import { api, errorMessage, useResource } from '../api';
import { useAuth, useToast } from '../context';
import { Button, Dialog, ErrorState, Loading } from './ui';

export function EmailChangeSettings({ onChanged }: { onChanged: () => void }) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const id = useId();
  const resource = useResource<EmailChangeStatus>('/api/account/email-change');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingEmailChange | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [time, setTime] = useState(Date.now());
  useEffect(() => { if (resource.data) setPending(resource.data.pending); }, [resource.data]);
  useEffect(() => {
    if (!open) return;
    setTime(Date.now());
    const timer = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);
  const wait = pending ? Math.max(0, Math.ceil((Date.parse(pending.resendAt) - time) / 1000)) : 0;
  const expired = Boolean(pending && Date.parse(pending.expiresAt) <= time);
  const enabled = Boolean(resource.data?.enabled);
  const close = () => { if (!busy) { setOpen(false); setPassword(''); setCode(''); setError(''); setMessage(''); } };
  const show = () => { setOpen(true); setError(''); setMessage(''); resource.refresh(); };
  const deliveredMessage = (value: PendingEmailChange) => value.delivered
    ? '验证码已发送到新邮箱，请查收收件箱或垃圾邮件。'
    : '验证码未能发送。请稍后重新发送，或联系管理员检查邮件服务。';
  const send = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<{ pending: PendingEmailChange }>('/api/account/email-change', { method: 'POST', body: { email, currentPassword: password } });
      setPending(result.pending); setPassword(''); setCode(''); setTime(Date.now()); setMessage(deliveredMessage(result.pending));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); resource.refresh(); }
  };
  const resend = async () => {
    if (!pending) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ pending: PendingEmailChange }>('/api/account/email-change/resend', { method: 'POST', body: { requestId: pending.requestId } });
      setPending(result.pending); setCode(''); setTime(Date.now()); setMessage(deliveredMessage(result.pending));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); resource.refresh(); }
  };
  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (!pending) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ user: User }>('/api/account/email-change/confirm', { method: 'POST', body: { requestId: pending.requestId, code } });
      setUser(result.user); onChanged(); setPending(null); setCode(''); setEmail(''); setOpen(false); setMessage('');
      toast('登录邮箱已更换，今后请使用新邮箱登录');
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); resource.refresh(); }
  };
  const cancel = async (closeAfter: boolean) => {
    setBusy(true); setError('');
    try {
      await api('/api/account/email-change', { method: 'DELETE' });
      setEmail(pending?.email || email); setPending(null); setCode(''); setPassword(''); setMessage('');
      if (closeAfter) setOpen(false);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); resource.refresh(); }
  };
  return <div className="account-email-settings">
    <div className="account-email-row"><div><label htmlFor={id}>登录邮箱</label><input id={id} type="email" readOnly value={user!.email} autoComplete="username" /></div><Button type="button" onClick={show} disabled={resource.loading || (!enabled && !pending)}><Mail size={13} />更换邮箱</Button></div>
    {resource.error ? <p className="auth-error" role="alert">{resource.error}<button type="button" className="text-button" onClick={resource.refresh}>重试</button></p> : !resource.loading && !enabled && !pending && <p className="email-change-note">站点暂未启用邮件服务，请联系管理员后再更换邮箱。</p>}
    <Dialog open={open} onClose={close} title="更换登录邮箱" subtitle="验证完成前，原邮箱仍可用于登录。">
      <ol className="email-change-steps" aria-label="更换邮箱步骤"><li className={!pending ? 'active' : ''}><span>1</span>验证身份与新邮箱</li><li className={pending ? 'active' : ''}><span>2</span>确认验证码</li></ol>
      {resource.loading ? <Loading /> : resource.error ? <ErrorState error={resource.error} retry={resource.refresh} /> : pending ? <form className="form-stack" onSubmit={confirm}>
        <div className="email-change-recipient"><span>新登录邮箱</span><strong>{pending.email}</strong></div>
        <p className={pending.delivered ? 'email-change-note' : 'auth-error'} role="status">{message || deliveredMessage(pending)}</p>
        <label>新邮箱验证码<input className="verification-code" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus required pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} disabled={busy || !pending.delivered || expired || !pending.remainingAttempts} /></label>
        <small>{expired ? '验证码已过期，请修改新邮箱并重新验证当前密码。' : !pending.remainingAttempts ? '尝试次数已用完，请重新发送验证码。' : '验证码 10 分钟内有效，重新发送后请以最新邮件为准。'}</small>
        <Button type="button" busy={busy} disabled={!enabled || wait > 0 || expired} onClick={() => void resend()}><RefreshCw size={13} />{wait ? wait + ' 秒后可重新发送' : '重新发送验证码'}</Button>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <p className="email-change-note">更换成功后，当前设备保持登录；其他设备、API 令牌和旧找回链接会失效，原邮箱将收到通知。</p>
        <div className="dialog-actions email-change-actions"><Button type="button" disabled={busy} onClick={() => void cancel(false)}>修改新邮箱</Button><Button type="button" disabled={busy} onClick={() => void cancel(true)}>取消更换</Button><Button type="submit" variant="primary" busy={busy} disabled={!pending.delivered || expired || !pending.remainingAttempts}>确认更换</Button></div>
      </form> : <form className="form-stack" onSubmit={send}>
        <label>当前登录密码<input type="password" required maxLength={128} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
        <label>新邮箱地址<input type="email" required maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="填写可接收验证码的新邮箱" disabled={busy} /></label>
        <small>验证当前密码后，我们会向新邮箱发送 6 位验证码。</small>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="dialog-actions"><Button type="button" disabled={busy} onClick={close}>取消</Button><Button type="submit" variant="primary" busy={busy} disabled={!enabled}>发送验证码</Button></div>
      </form>}
    </Dialog>
  </div>;
}

import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check, Mail } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../context';
import { Button, Logo } from '../components/ui';

export function EmailAccountPage({ mode }: { mode: 'forgot' | 'reset' | 'verify' }) {
  const { setUser } = useAuth();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  const [email, setEmail] = useState(query.get('email') || '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(mode === 'verify' && query.has('email') ? query.get('delivered') === 'false' ? '账号已创建，但验证邮件未能发送。请重新发送或联系管理员。' : '请打开注册邮箱中的验证链接以完成注册。' : '');
  const title = mode === 'forgot' ? '找回密码' : mode === 'reset' ? '重置密码' : '验证邮箱';
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      if (mode === 'reset') {
        if (password !== confirmation) throw new Error('两次输入的密码不一致');
        await api('/api/auth/reset-password', { method: 'POST', body: { token, password } });
        setUser(null);
        setDone(true); setMessage('密码已重置，请使用新密码登录。');
      } else if (mode === 'verify' && token) {
        await api('/api/auth/verify-email', { method: 'POST', body: { token } });
        setDone(true); setMessage('邮箱验证成功，可以登录了。');
      } else {
        const result = await api<{ message: string }>('/api/auth/' + (mode === 'forgot' ? 'forgot-password' : 'resend-verification'), { method: 'POST', body: { email } });
        setMessage(result.message);
      }
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  return <div className="email-account-page"><Link to="/" aria-label="映屿首页"><Logo /></Link><section className="auth-card glass">
    <span className="auth-card-icon">{done ? <Check size={22} /> : <Mail size={22} />}</span><h2>{done ? '操作完成' : title}</h2>
    {message && <p role="status">{message}</p>}
    {done ? <Link to="/login" className="button primary full-width">返回登录</Link> : <form className="form-stack" onSubmit={submit}>
      {mode === 'reset' && token ? <><label>新密码<input type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label><label>确认新密码<input type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label></> : mode === 'verify' && token ? <p>点击确认完成邮箱验证。</p> : mode === 'reset' ? <p>重置链接缺失，请重新申请找回密码。</p> : <label>邮箱地址<input type="email" required maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {(mode !== 'reset' || token) && <Button type="submit" variant="primary" className="full-width" busy={busy}>{mode === 'reset' ? '保存新密码' : mode === 'verify' && token ? '确认验证邮箱' : '发送邮件'}</Button>}
      {mode === 'reset' && <Link to="/forgot-password">重新申请重置链接</Link>}
      {mode === 'verify' && token && <Link to="/verify-email">重新发送验证邮件</Link>}
    </form>}
    {!done && <Link to="/login" className="back-link">返回登录</Link>}
  </section></div>;
}

import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Leaf, LockKeyhole, Sparkles } from 'lucide-react';
import type { User } from '../../shared/types';
import { api, ApiError, errorMessage } from '../api';
import { useAuth } from '../context';
import { Button, Logo } from '../components/ui';

export function AuthPage({ register = false }: { register?: boolean }) {
  const { user, site, setUser } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const next = params.get('next') || '/app';
  const destination = next === '/app' || next.startsWith('/app/') || next === '/admin' || next.startsWith('/admin/') ? next : '/app';
  if (user) return <Navigate to={destination} replace />;
  const available = site!.initialized && (!register || site!.settings.registrationOpen);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const result = await api<{ user?: User; verificationRequired?: boolean; email?: string; delivered?: boolean }>('/api/auth/' + (register ? 'register' : 'login'), { method: 'POST', body: { email, password, ...(register ? { name } : {}) } });
      if (result.verificationRequired) navigate('/verify-email?' + new URLSearchParams({ email: result.email || email, delivered: String(result.delivered) }));
      else if (result.user) setUser(result.user);
    }
    catch (err) {
      if (err instanceof ApiError && err.details?.verificationRequired) navigate('/verify-email?' + new URLSearchParams({ email }));
      else setError(errorMessage(err));
    } finally { setBusy(false); }
  };
  return <div className="auth-page"><Link to="/" className="auth-back"><ArrowLeft size={14} />返回首页</Link><div className="auth-layout"><div className="auth-story"><Logo /><h1>收好日常，<br /><em>也收好热爱。</em></h1><p>每一个被你认真记录的瞬间，<br />都值得一个轻盈、安静的住处。</p><div className="auth-picture"><img src="/samples/lake.jpg" alt="安静的山间湖泊" /><div className="auth-picture-caption glass"><Leaf size={16} /><span>让生活里的小美好，有处可放。</span></div></div><small><LockKeyhole size={12} /> 你的空间，由你决定。</small></div>
    <section className="auth-card glass"><span className="auth-card-icon"><Sparkles size={22} /></span><h2>{register ? '你好，新的岛主' : '欢迎回到你的小岛'}</h2><p>{register ? '创建账号，为灵感留一片空间。' : '登录映屿，继续收藏生活的片刻。'}</p><div className="segmented auth-tabs"><Link className={!register ? 'selected' : ''} to={'/login?next=' + encodeURIComponent(destination)}>登录</Link><Link className={register ? 'selected' : ''} to={'/register?next=' + encodeURIComponent(destination)}>注册</Link></div>
    {!available ? <div className="inline-notice">{!site!.initialized ? '站点正在准备中，管理员完成初始化后即可注册和登录。' : '本站暂未开放注册，已有账号可以直接登录。'}</div> : <form onSubmit={submit} className="form-stack">
      {register && <label>你的名字<input required maxLength={40} value={name} onChange={event => setName(event.target.value)} placeholder="怎么称呼你？" autoComplete="nickname" /></label>}
      <label>邮箱地址<input type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
      <label>密码<div className="password-field"><input type={visible ? 'text' : 'password'} required minLength={register ? 10 : 1} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder={register ? '至少 10 个字符' : '输入你的密码'} autoComplete={register ? 'new-password' : 'current-password'} /><button className="icon-button" type="button" aria-label={visible ? '隐藏密码' : '显示密码'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button variant="primary" busy={busy} className="full-width" type="submit">{register ? '创建我的小岛' : '登录我的空间'}<ArrowRight size={14} /></Button>
    </form>}<p className="auth-footnote">{register ? '免费使用，无需绑定支付。' : site?.email?.passwordReset ? <Link to="/forgot-password">忘记密码？通过邮箱找回</Link> : '忘记密码？请联系站点管理员。'}</p></section></div></div>;
}

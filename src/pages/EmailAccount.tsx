import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Check, Mail } from 'lucide-react';
import type { User } from '../../shared/types';
import { api, errorMessage } from '../api';
import { useAuth } from '../context';
import { Button, Logo } from '../components/ui';

function rememberedCooldown(email:string) { try { return Number(sessionStorage.getItem('verification-sent:'+email)||0)+60000; } catch { return 0; } }
export function EmailAccountPage({ mode }: { mode: 'forgot' | 'reset' | 'verify' }) {
  const { setUser }=useAuth();
  const location=useLocation();
  const navigate=useNavigate();
  const query=new URLSearchParams(location.search);
  const token=new URLSearchParams(location.hash.slice(1)).get('token')||'';
  const [email,setEmail]=useState(query.get('email')||'');
  const [activeEmail,setActiveEmail]=useState(mode==='verify'?query.get('email')||'':'');
  const [code,setCode]=useState('');
  const [password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false);
  const [sending,setSending]=useState(false);
  const [done,setDone]=useState(false);
  const [error,setError]=useState('');
  const [until,setUntil]=useState(()=>rememberedCooldown(query.get('email')||''));
  const [time,setTime]=useState(Date.now());
  const [message,setMessage]=useState(mode==='verify'&&query.has('email')?(query.get('delivered')==='false'?'账号已创建，但邮件未能发送。请重新获取验证码或联系管理员。':'验证码已发送，请查收邮箱并填写下方的 6 位验证码。'):'');
  useEffect(()=>{const timer=setInterval(()=>setTime(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const cooldown=Math.max(0,Math.ceil((until-time)/1000));
  const title=mode==='forgot'?'找回密码':mode==='reset'?'重置密码':'验证邮箱';
  const resend=async()=>{
    setError('');setSending(true);
    try {
      const recipient=activeEmail||email;
      const result=await api<{message:string;retryAfter:number}>('/api/auth/resend-verification',{method:'POST',body:{email:recipient}});
      const timestamp=Date.now();try{sessionStorage.setItem('verification-sent:'+recipient,String(timestamp));}catch{}
      setUntil(timestamp+result.retryAfter*1000);setTime(timestamp);setActiveEmail(recipient);setCode('');setMessage(result.message);
      navigate('/verify-email?'+new URLSearchParams({email:recipient}),{replace:true});
    } catch(cause){setError(errorMessage(cause));}finally{setSending(false);}
  };
  const submit=async(event:FormEvent)=>{
    event.preventDefault();setError('');
    if(mode==='verify'&&!token&&!activeEmail){await resend();return;}
    setBusy(true);
    try {
      if(mode==='reset') {
        if(password!==confirmation)throw new Error('两次输入的密码不一致');
        await api('/api/auth/reset-password',{method:'POST',body:{token,password}});
        setUser(null);setDone(true);setMessage('密码已重置，请使用新密码登录。');
      } else if(mode==='verify') {
        const result=await api<{user:User}>('/api/auth/verify-email',{method:'POST',body:token?{token}:{email:activeEmail,code}});
        setUser(result.user);navigate('/app',{replace:true});
      } else {
        const result=await api<{message:string}>('/api/auth/forgot-password',{method:'POST',body:{email}});
        setMessage(result.message);
      }
    }catch(cause){setError(errorMessage(cause));}finally{setBusy(false);}
  };
  return <div className="email-account-page"><Link to="/" aria-label="映屿首页"><Logo /></Link><section className="auth-card glass">
    <span className="auth-card-icon">{done?<Check size={22}/>:<Mail size={22}/>}</span><h2>{done?'操作完成':title}</h2>
    {message&&<p role="status">{message}</p>}
    {done?<Link to="/login" className="button primary full-width">返回登录</Link>:<form className="form-stack" onSubmit={submit}>
      {mode==='reset'&&token?<><label>新密码<input type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={password} onChange={event=>setPassword(event.target.value)}/></label><label>确认新密码<input type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label></>:mode==='verify'&&token?<p>点击确认完成邮箱验证。</p>:mode==='verify'&&activeEmail?<>
        <div className="verification-address"><span>验证邮箱</span><strong>{activeEmail}</strong><button type="button" onClick={()=>{setActiveEmail('');setCode('');setMessage('');setError('');}}>更换邮箱</button></div>
        <label>6 位验证码<input className="verification-code" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus required pattern="[0-9]{6}" maxLength={6} value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,''))} placeholder="000000" /></label>
        <small>验证码 10 分钟内有效，请以最新邮件为准。</small>
      </>:mode==='reset'?<p>重置链接缺失，请重新申请找回密码。</p>:<label>邮箱地址<input type="email" required maxLength={254} autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)}/></label>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      {(mode!=='reset'||token)&&<Button type="submit" variant="primary" className="full-width" busy={busy||(!activeEmail&&sending)} disabled={sending}>{mode==='reset'?'保存新密码':mode==='verify'&&(token||activeEmail)?token?'确认验证邮箱':'验证并进入工作台':mode==='verify'?'发送验证码':'发送邮件'}</Button>}
      {mode==='verify'&&activeEmail&&!token&&<Button type="button" variant="ghost" busy={sending} disabled={busy||cooldown>0} onClick={()=>void resend()}>{cooldown>0?`${cooldown} 秒后可重新发送`:'重新发送验证码'}</Button>}
      {mode==='reset'&&<Link to="/forgot-password">重新申请重置链接</Link>}
      {mode==='verify'&&token&&<Link to="/verify-email">重新获取验证码</Link>}
    </form>}
    {!done&&<Link to="/login" className="back-link">返回登录</Link>}
  </section></div>;
}

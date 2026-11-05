import { useEffect, useState, type FormEvent } from 'react';
import { Mail, Save, Send } from 'lucide-react';
import type { MailLog, MailSettings, PublicMailSettings } from '../../shared/types';
import { api, errorMessage, formatDate, useResource } from '../api';
import { useAuth, useToast } from '../context';
import { Button, ErrorState, Loading, PageHeading, Switch } from '../components/ui';

const kinds: Record<string, string> = { test: '测试邮件', verify: '注册验证', reset: '找回密码', 'quota-request': '扩容申请回执', 'quota-review-needed': '待审核通知', 'quota-reviewed': '审核结果', 'quota-updated': '配额调整' };

export function AdminMailPage() {
  const { user, refreshSite } = useAuth();
  const toast = useToast();
  const resource = useResource<{ settings: PublicMailSettings; logs: MailLog[] }>('/api/admin/mail');
  const [settings, setSettings] = useState<MailSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [recipient, setRecipient] = useState(user?.email || '');
  useEffect(() => { if (resource.data && !dirty) setSettings({ ...resource.data.settings, password: '' }); }, [resource.data, dirty]);
  const update = <K extends keyof MailSettings>(key: K, value: MailSettings[K]) => { setDirty(true); setSettings(current => current ? { ...current, [key]: value } : current); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try { await api('/api/admin/mail', { method: 'PATCH', body: settings }); setDirty(false); resource.refresh(); await refreshSite(); toast('邮件设置已保存'); }
    catch (error) { toast(errorMessage(error), 'error'); } finally { setSaving(false); }
  };
  const test = async (event: FormEvent) => {
    event.preventDefault(); setSending(true);
    try { const result = await api<{ message: string }>('/api/admin/mail/test', { method: 'POST', body: { recipient } }); toast(result.message); }
    catch (error) { toast(errorMessage(error), 'error'); } finally { setSending(false); resource.refresh(); }
  };
  return <><PageHeading title="邮件设置" />{resource.loading && !settings ? <Loading /> : resource.error ? <ErrorState error={resource.error} retry={resource.refresh} /> : settings && <>
    <form className="site-settings-form" onSubmit={save}>
      <section className="settings-panel glass"><div className="panel-heading"><h3><Mail size={15} />SMTP 服务</h3></div>
        <div className="setting-row"><div><strong>启用邮件服务</strong><p>保存配置后，可发送测试邮件确认连接。</p></div><Switch label="启用邮件服务" checked={settings.enabled} onChange={value => update('enabled', value)} /></div>
        <div className="form-stack">
          <label>SMTP 主机<input required={settings.enabled} value={settings.host} onChange={event => update('host', event.target.value)} placeholder="smtp.example.com" autoComplete="off" /></label>
          <div className="form-columns"><label>端口<input type="number" required min={1} max={65535} value={settings.port} onChange={event => update('port', Number(event.target.value))} /></label>
            <label>连接加密<select value={settings.encryption} onChange={event => { const mode = event.target.value as MailSettings['encryption']; update('encryption', mode); update('port', mode === 'tls' ? 465 : mode === 'starttls' ? 587 : 25); }}><option value="starttls">STARTTLS（587）</option><option value="tls">TLS（465）</option><option value="none">不加密（内网服务）</option></select></label></div>
          <label>SMTP 用户名<input value={settings.username} onChange={event => update('username', event.target.value)} autoComplete="off" /></label>
          <label>SMTP 密码 / 授权码<input type="password" value={settings.password} onChange={event => update('password', event.target.value)} autoComplete="new-password" placeholder={resource.data?.settings.hasPassword ? '已设置，留空保留' : '输入邮箱授权码或密码'} /></label>
          <label>发件邮箱<input type="email" required={settings.enabled} value={settings.fromEmail} onChange={event => update('fromEmail', event.target.value)} placeholder="noreply@example.com" /></label>
          <label>发件人名称<input value={settings.fromName} maxLength={80} onChange={event => update('fromName', event.target.value)} placeholder="留空使用站点名称" /></label>
        </div>
      </section>
      <section className="settings-panel glass"><div className="panel-heading"><h3>邮件用途</h3></div>
        <div className="setting-row"><div><strong>找回密码</strong><p>发送 30 分钟内有效的一次性重置链接。</p></div><Switch label="邮件找回密码" checked={settings.passwordReset} onChange={value => update('passwordReset', value)} /></div>
        <div className="setting-row"><div><strong>注册邮箱验证</strong><p>新用户验证邮箱后才能登录。已有账号不受影响。</p></div><Switch label="注册邮箱验证" checked={settings.verification} onChange={value => update('verification', value)} /></div>
        <div className="setting-row"><div><strong>扩容与审核通知</strong><p>通知申请人提交结果、审核结果和配额调整，并提醒管理员处理新申请。</p></div><Switch label="扩容与审核通知" checked={settings.quotaNotifications} onChange={value => update('quotaNotifications', value)} /></div>
        <div className="form-stack"><label>审核通知邮箱<input type="email" value={settings.reviewInbox} onChange={event => update('reviewInbox', event.target.value)} placeholder="留空通知已启用的管理员" /></label><p className="panel-description">所有邮件使用 HTML 模板并附带纯文本版本。发送失败记录在下方，不会撤销已提交的扩容申请或审批结果。</p></div>
      </section>
      <div className="settings-save"><Button type="submit" variant="primary" busy={saving} disabled={sending}><Save size={14} />保存邮件设置</Button></div>
    </form>
    <section className="settings-panel glass mail-test-panel"><div className="panel-heading"><h3>发送测试邮件</h3></div><form className="token-create" onSubmit={test}><input type="email" aria-label="测试邮件收件人" required value={recipient} onChange={event => setRecipient(event.target.value)} /><Button type="submit" busy={sending} disabled={saving || dirty || !settings.enabled}><Send size={14} />发送测试邮件</Button></form>{dirty && <p className="panel-description">请先保存当前配置，再发送测试邮件。</p>}</section>
    <section className="settings-panel glass mail-log-panel"><div className="panel-heading"><h3>最近发送记录</h3></div>{!resource.data?.logs.length ? <p className="panel-description">暂无发送记录。</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>邮件类型</th><th>收件人</th><th>结果</th><th>时间</th></tr></thead><tbody>{resource.data.logs.map(log => <tr key={log.id}><td>{kinds[log.kind] || log.kind}</td><td>{log.recipient}</td><td><span className={'badge ' + (log.status === 'sent' ? 'green' : 'amber')}>{log.status === 'sent' ? '服务器已接受' : '发送失败'}</span>{log.error && <small className="table-subtext">{log.error}</small>}</td><td>{formatDate(log.createdAt, true)}</td></tr>)}</tbody></table></div>}</section>
  </>}</>;
}

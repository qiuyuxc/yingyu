import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { MailSettings, PublicMailSettings } from '../shared/types.js';
import type { AppConfig } from './config.js';
import { getSettings, now, type DB, type Row } from './db.js';
import { decryptConfig, encryptConfig } from './security.js';

export const mailSchema = z.object({
  enabled: z.boolean(), host: z.string().trim().max(253).regex(/^[a-zA-Z0-9.:-]*$/, 'SMTP 主机名格式不正确'),
  port: z.number().int().min(1).max(65535), encryption: z.enum(['tls', 'starttls', 'none']),
  username: z.string().trim().max(254), password: z.string().max(2000).default(''),
  fromEmail: z.union([z.email(), z.literal('')]), fromName: z.string().trim().max(80).regex(/^[^\r\n]*$/),
  passwordReset: z.boolean(), verification: z.boolean(), quotaNotifications: z.boolean(),
  reviewInbox: z.union([z.email(), z.literal('')]),
}).superRefine((value, ctx) => {
  if (value.enabled && (!value.host || !value.fromEmail)) ctx.addIssue({ code: 'custom', message: '启用邮件前请填写 SMTP 主机和发件邮箱' });
});

const defaults: MailSettings = {
  enabled: false, host: '', port: 587, encryption: 'starttls', username: '', password: '',
  fromEmail: '', fromName: '', passwordReset: true, verification: true, quotaNotifications: true, reviewInbox: '',
};
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export interface MailContent { code?:string; title: string; paragraphs: string[]; action?: { label: string; url: string } }

export function renderMail(siteName: string, content: MailContent) {
  const escape = escapeHtml;
  const action = content.action;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(content.title)}</title></head><body style="margin:0;background:#f3f4f6;color:#262a31;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px"><tr><td style="padding:32px"><p style="margin:0 0 28px;font-size:15px;font-weight:700;color:#596273">${escape(siteName)}</p><h1 style="margin:0 0 24px;font-size:23px;line-height:1.4">${escape(content.title)}</h1>${content.code ? `<p style="font-size:32px;letter-spacing:8px;font-weight:700;text-align:center;padding:18px;background:#f3f4f6;border-radius:10px">${escape(content.code)}</p>` : ''}${content.paragraphs.map(text => `<p style="margin:0 0 16px;font-size:14px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere">${escape(text)}</p>`).join('')}${action ? `<p style="margin:28px 0"><a href="${escape(action.url)}" style="display:inline-block;padding:12px 24px;background:#303640;color:#ffffff;text-decoration:none;border-radius:9px;font-size:14px;font-weight:600">${escape(action.label)}</a></p><p style="font-size:12px;color:#6b7280;line-height:1.8;overflow-wrap:anywhere">按钮无法打开时，请复制以下地址：<br><a href="${escape(action.url)}" style="color:#426399;word-break:break-all">${escape(action.url)}</a></p>` : ''}<hr style="margin:28px 0 18px;border:0;border-top:1px solid #e5e7eb"><p style="margin:0;font-size:12px;color:#7b8190;line-height:1.8">此邮件由 ${escape(siteName)} 自动发送，请勿直接回复。</p></td></tr></table></td></tr></table></body></html>`;
  return { html, text: `${siteName}\n\n${content.title}\n\n${content.paragraphs.join('\n\n')}${action ? `\n\n${action.label}：${action.url}` : ''}\n\n此邮件由系统自动发送，请勿直接回复。` };
}

export function createMailService(db: DB, config: AppConfig) {
  const settings = (): MailSettings => {
    const row = db.prepare('SELECT config FROM mail_config WHERE id=1').get() as Row | undefined;
    return row ? { ...defaults, ...decryptConfig(row.config, config.encryptionKey) } : { ...defaults };
  };
  const publicSettings = (): PublicMailSettings => { const { password, ...rest } = settings(); return { ...rest, hasPassword: Boolean(password) }; };
  const save = (input: MailSettings) => {
    const value = { ...input, password: input.password || settings().password };
    db.prepare('INSERT INTO mail_config(id,config) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config').run(encryptConfig(value, config.encryptionKey));
    return publicSettings();
  };
  const send = async (kind: string, recipient: string, content: MailContent) => {
    const smtp = settings();
    if (!smtp.enabled) return false;
    const siteName = getSettings(db).siteName;
    const transport = nodemailer.createTransport({
      host: smtp.host, port: smtp.port, secure: smtp.encryption === 'tls',
      requireTLS: smtp.encryption === 'starttls', ignoreTLS: smtp.encryption === 'none',
      auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
      disableFileAccess: true, disableUrlAccess: true,
    });
    let error = '';
    try {
      const result = await transport.sendMail({
        from: { name: smtp.fromName || siteName, address: smtp.fromEmail }, to: recipient,
        subject: `[${siteName}] ${content.title}`, ...renderMail(siteName, content),
      });
      if (!result.accepted.length) error = '收件地址被 SMTP 服务器拒绝';
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      error = code === 'EAUTH' ? 'SMTP 认证失败，请检查用户名和密码' : code === 'ETIMEDOUT' ? 'SMTP 连接超时' : 'SMTP 发送失败，请检查主机、端口、加密方式和发件权限';
    } finally { transport.close(); }
    db.prepare('INSERT INTO mail_logs(id,recipient,kind,status,error,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(), recipient, kind, error ? 'failed' : 'sent', error, now());
    db.prepare('DELETE FROM mail_logs WHERE id NOT IN (SELECT id FROM mail_logs ORDER BY created_at DESC LIMIT 100)').run();
    return !error;
  };
  return { settings, publicSettings, save, send };
}

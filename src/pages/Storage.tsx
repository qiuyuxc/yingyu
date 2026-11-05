import { useState, type FormEvent } from 'react';
import { Check, Cloud, Globe, HardDrive, Pencil, Plus, Radio, Server, ShieldCheck, Trash2, Unplug } from 'lucide-react';
import type { StorageConfig, StorageKind, StorageProvider } from '../../shared/types';
import { api, errorMessage, formatBytes, useResource } from '../api';
import { useToast } from '../context';
import { Button, Confirm, Dialog, ErrorState, Loading, PageHeading, Switch } from '../components/ui';

const kindNames: Record<StorageKind, string> = { local: '本地存储', r2: 'Cloudflare R2', s3: 'S3 兼容存储', webdav: 'WebDAV' };
const kindIcons = { local: HardDrive, r2: Cloud, s3: Server, webdav: Globe };
type ConnectionState = { ok: boolean; message: string };
export function StoragePage() {
  const resource = useResource<{ providers: StorageProvider[] }>('/api/admin/storage');
  const toast = useToast();
  const [editing, setEditing] = useState<StorageProvider | 'new' | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<StorageKind>('r2');
  const [config, setConfig] = useState<StorageConfig>({});
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [connections, setConnections] = useState<Record<string, ConnectionState>>({});
  const [deleting, setDeleting] = useState<StorageProvider | null>(null);
  const existing = editing && editing !== 'new' ? editing : null;
  const open = (provider?: StorageProvider) => { setEditing(provider || 'new'); setName(provider?.name || 'Cloudflare R2'); setKind(provider?.kind || 'r2'); setConfig(provider ? { ...provider.config, secretAccessKey: '', password: '' } : { region: 'auto', forcePathStyle: true }); };
  const update = <K extends keyof StorageConfig>(key: K, value: StorageConfig[K]) => setConfig(current => ({ ...current, [key]: value }));
  const changeKind = (value: StorageKind) => { setKind(value); setName(kindNames[value]); setConfig(value === 'webdav' ? { path: 'yingyu' } : { region: value === 'r2' ? 'auto' : 'us-east-1', forcePathStyle: true }); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await api('/api/admin/storage' + (existing ? '/' + existing.id : ''), { method: existing ? 'PATCH' : 'POST', body: { name, kind, config } }); if (existing) setConnections(items => { const next = { ...items }; delete next[existing.id]; return next; }); setEditing(null); resource.refresh(); toast('存储配置已保存，可以测试连接'); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  const test = async (provider: StorageProvider) => {
    setWorking(provider.id);
    try { const result = await api<{ message: string }>('/api/admin/storage/' + provider.id + '/test', { method: 'POST' }); setConnections(items => ({ ...items, [provider.id]: { ok: true, message: result.message } })); toast('存储连接正常'); }
    catch (err) { const message = errorMessage(err); setConnections(items => ({ ...items, [provider.id]: { ok: false, message } })); toast(message, 'error'); } finally { setWorking(null); }
  };
  const activate = async (provider: StorageProvider) => {
    setWorking(provider.id);
    try {
      if (!connections[provider.id]?.ok) { const result = await api<{ message: string }>('/api/admin/storage/' + provider.id + '/test', { method: 'POST' }); setConnections(items => ({ ...items, [provider.id]: { ok: true, message: result.message } })); }
      await api('/api/admin/storage/' + provider.id + '/activate', { method: 'POST' }); resource.refresh(); toast('新上传的图片将保存到 ' + provider.name);
    } catch (err) { const message = errorMessage(err); setConnections(items => ({ ...items, [provider.id]: { ok: false, message } })); toast(message, 'error'); } finally { setWorking(null); }
  };
  const remove = async () => {
    if (!deleting) return; setBusy(true);
    try { await api('/api/admin/storage/' + deleting.id, { method: 'DELETE' }); setDeleting(null); resource.refresh(); toast('存储配置已删除'); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  return <><PageHeading title="存储管理" action={<Button variant="primary" onClick={() => open()}><Plus size={14} />添加存储</Button>} /><div className="storage-notice glass"><ShieldCheck size={19} /><div><strong>切换默认存储，只影响新上传的图片。</strong><p>已有图片会继续从原来的存储读取；存储中仍有图片时，不能删除配置或修改存储位置。</p></div></div>
    {resource.loading ? <Loading /> : resource.error ? <ErrorState error={resource.error} retry={resource.refresh} /> : <div className="storage-grid">{resource.data?.providers.map(provider => { const Icon = kindIcons[provider.kind]; const connection = connections[provider.id]; return <article className={'storage-card glass ' + (provider.active ? 'storage-active' : '')} key={provider.id}><div className="storage-card-heading"><span className={'stat-icon ' + (provider.kind === 'r2' ? 'peach' : provider.kind === 'webdav' ? 'lilac' : 'mint')}><Icon size={20} /></span><div><h3>{provider.name}</h3><span>{kindNames[provider.kind]}</span></div><span className={'badge ' + (provider.active ? 'green' : 'neutral')}>{provider.active ? <><Radio size={10} />默认存储</> : '待启用'}</span></div><div className="storage-endpoint"><span>存储位置</span><strong title={provider.config.endpoint || '服务器本地'}>{provider.config.endpoint || '服务器本地'}</strong>{provider.config.bucket && <small>Bucket · {provider.config.bucket}</small>}{provider.config.path && <small>目录 · {provider.config.path}</small>}</div><div className="storage-card-stats"><div><span>图片数量</span><strong>{provider.imageCount}<small> 张</small></strong></div><div><span>已用空间</span><strong>{formatBytes(provider.usedBytes)}</strong></div></div>{connection && <p className={'connection-result ' + (connection.ok ? 'success' : 'failure')}>{connection.ok ? <Check size={12} /> : <Unplug size={12} />}{connection.message}</p>}<div className="storage-card-actions"><Button busy={working === provider.id} disabled={Boolean(working)} onClick={() => void test(provider)}>测试连接</Button>{provider.kind !== 'local' && <Button className="icon-button" aria-label={'编辑存储 ' + provider.name} onClick={() => open(provider)} disabled={Boolean(working)}><Pencil size={13} /></Button>}{!provider.active && <Button variant="primary" disabled={Boolean(working)} onClick={() => void activate(provider)}>设为默认</Button>}{!provider.active && provider.kind !== 'local' && <Button className="icon-button" aria-label={'删除存储 ' + provider.name} disabled={provider.imageCount > 0 || Boolean(working)} onClick={() => setDeleting(provider)}><Trash2 size={13} /></Button>}</div></article>; })}</div>}
    <div className="storage-credentials-note"><LockNote />存储密钥加密保存，后台不会再次返回完整密钥。修改配置时，密钥留空可保留现有值。</div>
    <Dialog open={Boolean(editing)} onClose={busy ? () => {} : () => setEditing(null)} title={existing ? '编辑存储配置' : '连接新的存储'} subtitle="保存后可测试写入、读取和删除权限。"><form className="form-stack" onSubmit={save}><label>存储名称<input value={name} required maxLength={40} onChange={event => setName(event.target.value)} /></label><label>存储类型<select value={kind} disabled={Boolean(existing)} onChange={event => changeKind(event.target.value as StorageKind)}><option value="r2">Cloudflare R2</option><option value="s3">S3 兼容存储</option><option value="webdav">WebDAV</option>{kind === 'local' && <option value="local">本地存储</option>}</select></label><label>服务端点<input type="url" required value={config.endpoint || ''} onChange={event => update('endpoint', event.target.value)} placeholder={kind === 'r2' ? 'https://账户ID.r2.cloudflarestorage.com' : kind === 'webdav' ? 'https://dav.example.com/remote.php/dav/files/user/' : 'https://s3.example.com'} autoComplete="off" /></label>
      {kind === 'webdav' ? <><label>存储目录<input value={config.path || ''} onChange={event => update('path', event.target.value)} placeholder="yingyu" /></label><label>用户名<input value={config.username || ''} required onChange={event => update('username', event.target.value)} autoComplete="off" /></label><label>密码 / 应用密码<input type="password" value={config.password || ''} required={!existing?.hasSecrets} onChange={event => update('password', event.target.value)} placeholder={existing?.hasSecrets ? '已设置，留空保留' : 'WebDAV 密码'} autoComplete="new-password" /></label></> : <><div className="form-columns"><label>存储桶名称<input value={config.bucket || ''} required onChange={event => update('bucket', event.target.value)} placeholder="my-images" /></label><label>Region<input value={kind === 'r2' ? 'auto' : config.region || ''} disabled={kind === 'r2'} onChange={event => update('region', event.target.value)} placeholder="us-east-1" /></label></div><label>Access Key ID<input required value={config.accessKeyId || ''} onChange={event => update('accessKeyId', event.target.value)} autoComplete="off" /></label><label>Secret Access Key<input type="password" required={!existing?.hasSecrets} value={config.secretAccessKey || ''} onChange={event => update('secretAccessKey', event.target.value)} placeholder={existing?.hasSecrets ? '已设置，留空保留' : '输入访问密钥'} autoComplete="new-password" /></label>{kind === 's3' && <div className="setting-row"><div><strong>使用路径式寻址</strong><p>适用于 MinIO 等 S3 兼容服务。</p></div><Switch label="使用路径式寻址" checked={config.forcePathStyle ?? true} onChange={value => update('forcePathStyle', value)} /></div>}</>}
      {existing && existing.imageCount > 0 && <p className="inline-notice">该存储已有图片，仅可修改名称和访问凭据；存储位置需通过新建配置调整。</p>}<div className="dialog-actions"><Button type="button" disabled={busy} onClick={() => setEditing(null)}>取消</Button><Button type="submit" variant="primary" busy={busy}>保存配置</Button></div></form></Dialog>
    <Confirm open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={() => void remove()} busy={busy} title="删除这个存储配置？">仅删除“{deleting?.name}”的连接配置。此配置须没有图片且未被设为默认存储。</Confirm>
  </>;
}
function LockNote() { return <ShieldCheck size={13} />; }

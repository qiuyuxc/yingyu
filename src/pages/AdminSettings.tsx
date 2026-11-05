import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, Images, Save, Search, Trash2 } from 'lucide-react';
import { GiB, MiB, type HostedImage, type SiteSettings } from '../../shared/types';
import { api, errorMessage, formatBytes, formatDate, useDebounced, useResource } from '../api';
import { useAuth, useToast } from '../context';
import { Button, Confirm, Dialog, EmptyState, ErrorState, Loading, PageHeading, Pagination, Switch } from '../components/ui';

export function AdminSettingsPage() {
  const resource = useResource<{ settings: SiteSettings }>('/api/admin/settings');
  const { refreshSite } = useAuth();
  const toast = useToast();
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (resource.data) setSettings(resource.data.settings); }, [resource.data]);
  const update = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => setSettings(current => current ? { ...current, [key]: value } : current);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await api('/api/admin/settings', { method: 'PATCH', body: settings }); await refreshSite(); toast('站点设置已保存'); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  return <><PageHeading title="站点设置" />{resource.loading ? <Loading /> : resource.error ? <ErrorState error={resource.error} retry={resource.refresh} /> : settings && <form className="site-settings-form" onSubmit={save}><section className="settings-panel glass"><div className="panel-heading"><h3>基本信息</h3></div><div className="form-stack"><label>站点名称<input value={settings.siteName} required maxLength={40} onChange={event => update('siteName', event.target.value)} /></label><label>站点介绍<input value={settings.tagline} maxLength={120} onChange={event => update('tagline', event.target.value)} /></label><label>站点公告<textarea rows={4} maxLength={500} value={settings.announcement} onChange={event => update('announcement', event.target.value)} placeholder="在我的图片页向用户展示的公告" /></label></div></section><section className="settings-panel glass"><div className="panel-heading"><h3>注册与配额</h3></div><div className="setting-row"><div><strong>开放用户注册</strong><p>关闭后，已有用户仍可正常登录。</p></div><Switch label="开放用户注册" checked={settings.registrationOpen} onChange={value => update('registrationOpen', value)} /></div><div className="form-stack"><label>新用户默认配额<div className="input-suffix"><input type="number" required step="any" min={0} max={102400} value={settings.defaultQuotaBytes / GiB} onChange={event => update('defaultQuotaBytes', Math.round(Number(event.target.value) * GiB))} /><span>GB</span></div><small>仅影响新注册用户，已有用户通过“用户管理”调配。</small></label><label>单张图片上传上限<div className="input-suffix"><input type="number" required min={1} max={100} step={1} value={settings.maxUploadBytes / MiB} onChange={event => update('maxUploadBytes', Number(event.target.value) * MiB)} /><span>MB</span></div><small>范围 1–100 MB，同时受用户剩余配额限制。</small></label></div></section><div className="settings-save"><Button type="submit" variant="primary" busy={busy}><Save size={14} />保存站点设置</Button></div></form>}</>;
}

export function AdminImagesPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [page, setPage] = useState(1);
  const resource = useResource<{ images: HostedImage[]; total: number }>('/api/admin/images?' + new URLSearchParams({ search: debounced, page: String(page) }));
  const [preview, setPreview] = useState<HostedImage | null>(null);
  const [deleting, setDeleting] = useState<HostedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!deleting) return; setBusy(true);
    try { await api('/api/admin/images/' + deleting.id, { method: 'DELETE' }); setDeleting(null); resource.refresh(); toast('图片已删除，用户空间已归还'); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  return <><PageHeading title="图片管理" /><section className="admin-table-panel glass"><div className="table-toolbar"><div className="search-field"><Search size={14} /><input aria-label="搜索站点图片" value={search} maxLength={100} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="搜索图片名称或用户名…" /></div><span>{resource.data?.total ?? '—'} 张图片</span></div>{resource.loading ? <Loading /> : resource.error ? <ErrorState error={resource.error} retry={resource.refresh} /> : !resource.data?.images.length ? <EmptyState icon={<Images size={26} />} title="没有找到图片" description="用户上传的图片会显示在这里。" /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>图片</th><th>所有者</th><th>可见性</th><th>大小 / 存储</th><th>上传时间</th><th>操作</th></tr></thead><tbody>{resource.data.images.map(image => <tr key={image.id}><td><button className="table-image-name" aria-label={'预览图片 ' + image.name} onClick={() => setPreview(image)}><img src={image.url} alt="" loading="lazy" /><span>{image.name}</span></button></td><td>{image.ownerName}</td><td><span className={'badge ' + (image.visibility === 'private' ? 'neutral' : 'green')}>{image.visibility === 'private' ? '私密' : '公开'}</span></td><td>{formatBytes(image.size)}<small className="table-subtext">{image.storageName}</small></td><td>{formatDate(image.createdAt, true)}</td><td><Button aria-label={'删除图片 ' + image.name} variant="ghost" onClick={() => setDeleting(image)}><Trash2 size={14} /></Button></td></tr>)}</tbody></table></div>}<Pagination page={page} total={resource.data?.total || 0} onPage={setPage} /></section>
    <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.name || '图片预览'} subtitle={'所有者：' + (preview?.ownerName || '')} wide>{preview && <div className="admin-image-preview"><img src={preview.url} alt={preview.name} /><div><span>{formatBytes(preview.size)} · {preview.storageName}</span><a className="button secondary" href={preview.url} target="_blank" rel="noreferrer"><ExternalLink size={12} />查看原图</a></div></div>}</Dialog>
    <Confirm open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={() => void remove()} busy={busy} title="删除这张用户图片？">“{deleting?.name}”的原有外链会失效，删除成功后归还 {deleting ? formatBytes(deleting.size) : ''} 空间给 {deleting?.ownerName}。</Confirm>
  </>;
}

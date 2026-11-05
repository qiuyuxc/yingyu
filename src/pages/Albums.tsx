import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FolderOpen, Plus, Trash2 } from 'lucide-react';
import type { Album } from '../../shared/types';
import { api, errorMessage, formatDate, useResource } from '../api';
import { useToast } from '../context';
import { Button, Confirm, Dialog, EmptyState, ErrorState, Loading, PageHeading } from '../components/ui';

export function AlbumsPage() {
  const resource = useResource<{ albums: Album[] }>('/api/albums');
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Album | null>(null);
  const create = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await api('/api/albums', { method: 'POST', body: { name } }); setCreating(false); setName(''); resource.refresh(); toast('新的相册已创建'); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!deleting) return; setBusy(true);
    try { await api('/api/albums/' + deleting.id, { method: 'DELETE' }); setDeleting(null); resource.refresh(); toast('相册已删除，图片仍保留在资源库'); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  return <><PageHeading title="我的相册" action={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={15} />新建相册</Button>} />
    {resource.loading ? <Loading /> : resource.error ? <ErrorState error={resource.error} retry={resource.refresh} /> : !resource.data?.albums.length ? <div className="glass"><EmptyState icon={<FolderOpen size={29} />} title="暂无相册" description="创建相册，按用途分类整理图片。" action={<Button onClick={() => setCreating(true)}><Plus size={13} />创建第一个相册</Button>} /></div> : <div className="album-grid">{resource.data.albums.map((album, index) => <article className="album-card glass" key={album.id}><Link to={'/app/albums/' + album.id} className={'album-cover color-' + index % 4}><div className="folder-illustration"><span /><span /><FolderOpen size={44} strokeWidth={1.1} /></div><span className="album-count">{album.count} 张图片</span></Link><div className="album-card-info"><Link to={'/app/albums/' + album.id}><h3>{album.name}</h3><p>创建于 {formatDate(album.createdAt)} <ArrowRight size={12} /></p></Link><button className="icon-button" aria-label={'删除相册 ' + album.name} onClick={() => setDeleting(album)}><Trash2 size={14} /></button></div></article>)}</div>}
    <Dialog open={creating} onClose={busy ? () => {} : () => setCreating(false)} title="新建相册"><form className="form-stack" onSubmit={create}><label>相册名称<input value={name} onChange={event => setName(event.target.value)} required maxLength={40} placeholder="例如：山野来信" /></label><div className="dialog-actions"><Button type="button" disabled={busy} onClick={() => setCreating(false)}>取消</Button><Button variant="primary" type="submit" busy={busy}>创建相册</Button></div></form></Dialog>
    <Confirm open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={() => void remove()} busy={busy} title={'删除相册“' + (deleting?.name || '') + '”？'}>仅删除相册，里面的图片仍会保留在“我的图片”中。</Confirm>
  </>;
}

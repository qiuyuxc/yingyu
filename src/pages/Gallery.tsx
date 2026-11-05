import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, CloudUpload, Copy, Ellipsis, FolderOpen, Grid2X2, HardDrive, Images, List, LockKeyhole, Search, Star, Trash2, X } from 'lucide-react';
import type { Album, HostedImage } from '../../shared/types';
import { api, copyText, errorMessage, formatBytes, formatDate, useDebounced, useResource } from '../api';
import { useAuth, useToast } from '../context';
import { Button, Confirm, EmptyState, ErrorState, Loading, PageHeading, Pagination } from '../components/ui';
import { ImageDetail } from '../components/ImageDetail';
import { SiteAnnouncement } from '../components/SiteAnnouncement';
export { AlbumsPage } from './Albums';

type ImageCollection = { images: HostedImage[]; total: number; page: number; limit: number };
export function Gallery({ starred = false }: { starred?: boolean }) {
  const { albumId } = useParams();
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [sort, setSort] = useState('newest');
  const [visibility, setVisibility] = useState('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<HostedImage | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const query = new URLSearchParams({ page: String(page), limit: '40', search: debounced, sort, ...(albumId ? { albumId } : {}), ...(starred ? { starred: 'true' } : {}), ...(visibility !== 'all' ? { visibility } : {}) });
  const resource = useResource<ImageCollection>('/api/images?' + query);
  const albums = useResource<{ albums: Album[] }>('/api/albums');
  useEffect(() => { setSearch(''); setVisibility('all'); setDetail(null); setDeleting(null); }, [albumId, starred]);
  useEffect(() => { setPage(1); setSelected([]); }, [debounced, sort, visibility, albumId, starred]);
  useEffect(() => { setSelected([]); }, [page]);
  const album = albums.data?.albums.find(item => item.id === albumId);
  const images = resource.data?.images || [];
  const total = resource.data?.total || 0;
  const toggle = (id: string) => setSelected(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]);
  const refresh = () => { resource.refresh(); albums.refresh(); void refreshUser().catch(err => toast(errorMessage(err), 'error')); };
  const update = (image: HostedImage) => { setDetail(image); refresh(); };
  const star = async (image: HostedImage) => {
    try { await api('/api/images/' + image.id, { method: 'PATCH', body: { starred: !image.starred } }); resource.refresh(); }
    catch (err) { toast(errorMessage(err), 'error'); }
  };
  const copySelected = async () => {
    try { await copyText(images.filter(image => selected.includes(image.id)).map(image => image.url).join('\n')); toast('已复制 ' + selected.length + ' 条链接'); }
    catch (err) { toast(errorMessage(err), 'error'); }
  };
  const moveSelected = async (value: string) => {
    setBusy(true); let successful = 0;
    for (const id of selected) {
      try { await api('/api/images/' + id, { method: 'PATCH', body: { albumId: value === 'none' ? null : value } }); successful++; }
      catch (err) { toast(errorMessage(err), 'error'); }
    }
    if (successful) toast('已归档 ' + successful + ' 张图片'); setSelected([]); setBusy(false); refresh();
  };
  const remove = async () => {
    if (!deleting) return; setBusy(true); const failed: string[] = [];
    for (const id of deleting) {
      try { await api('/api/images/' + id, { method: 'DELETE' }); }
      catch (err) { failed.push(id); toast(errorMessage(err), 'error'); }
    }
    const removed = deleting.length - failed.length;
    if (removed) toast('已删除 ' + removed + ' 张图片，空间已归还');
    setSelected(failed); setDeleting(null); setDetail(null); setBusy(false); refresh();
  };
  const title = starred ? '收藏夹' : albumId ? album?.name || '相册图片' : '我的图片';
  return <>{!starred && !albumId && <SiteAnnouncement />}{albumId && <Link to="/app/albums" className="back-link"><ArrowLeft size={12} />返回相册</Link>}<PageHeading title={title} action={<Link to="/app/upload" className="button primary"><CloudUpload size={15} />上传图片<ArrowRight size={13} /></Link>} />
    {!starred && !albumId && <div className="library-stats"><div><span className="stat-icon mint"><Images size={18} /></span><span><small>已上传图片</small><strong>{user!.imageCount}<em> 张图片</em></strong></span></div><div><span className="stat-icon lilac"><HardDrive size={18} /></span><span><small>已用空间</small><strong>{formatBytes(user!.usedBytes)}<em> / {formatBytes(user!.quotaBytes)}</em></strong></span></div><Link to="/app/quota"><span className="stat-icon peach"><FolderOpen size={18} /></span><span><small>存储配额</small><strong className="stat-link">申请更多空间 <ArrowRight size={13} /></strong></span></Link></div>}
    <section className="library-panel"><div className="library-toolbar"><div className="search-field"><Search size={15} /><input aria-label="搜索图片" placeholder="搜索图片名称…" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="icon-button" aria-label="清空搜索" onClick={() => setSearch('')}><X size={12} /></button>}</div><div className="toolbar-controls"><select aria-label="筛选可见性" value={visibility} onChange={event => setVisibility(event.target.value)}><option value="all">所有图片</option><option value="public">公开图片</option><option value="private">私密图片</option></select><select aria-label="图片排序" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">最新上传</option><option value="oldest">最早上传</option><option value="largest">文件最大</option><option value="name">名称排序</option></select><div className="view-toggle segmented"><button aria-label="网格视图" aria-pressed={view === 'grid'} className={view === 'grid' ? 'selected' : ''} onClick={() => setView('grid')}><Grid2X2 size={14} /></button><button aria-label="列表视图" aria-pressed={view === 'list'} className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}><List size={15} /></button></div></div></div>
    {images.length > 0 && <div className="library-count"><label className="checkbox-label"><input type="checkbox" checked={images.length > 0 && images.every(image => selected.includes(image.id))} onChange={event => setSelected(event.target.checked ? images.map(image => image.id) : [])} />选择本页</label><span>{total} 张图片 <span className="little-dot">·</span> 图片列表</span></div>}
    {selected.length > 0 && <div className="selection-bar glass"><span><Check size={14} />已选择 {selected.length} 张</span><div><Button disabled={busy} onClick={copySelected}><Copy size={13} />复制链接</Button><select aria-label="批量移动到相册" value="" disabled={busy} onChange={event => void moveSelected(event.target.value)}><option value="" disabled>移动到相册</option><option value="none">移出相册</option>{albums.data?.albums.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><Button variant="danger" disabled={busy} onClick={() => setDeleting(selected)}><Trash2 size={13} />删除</Button><button className="icon-button" aria-label="取消选择" disabled={busy} onClick={() => setSelected([])}><X size={14} /></button></div></div>}
    {resource.loading ? <Loading /> : resource.error ? <ErrorState error={resource.error} retry={resource.refresh} /> : images.length === 0 ? <EmptyState icon={starred ? <Star size={28} /> : <Images size={28} />} title={search || visibility !== 'all' ? '没有找到相符的图片' : starred ? '暂无收藏图片' : albumId ? '相册中暂无图片' : '暂无图片'} description={search || visibility !== 'all' ? '试试其他名称，或调整筛选条件。' : starred ? '点击图片上的星标，就能在这里找到它。' : '上传一张图片，把生活里的小美好收好。'} action={<Link to={starred ? '/app' : '/app/upload'} className="button secondary">{starred ? '浏览我的图片' : '选择图片'}<ArrowRight size={13} /></Link>} /> : view === 'grid' ? <div className="image-grid">{images.map(image => <article className={'image-card glass ' + (selected.includes(image.id) ? 'is-selected' : '')} key={image.id}><div className="image-card-preview"><button className="image-open" onClick={() => setDetail(image)} aria-label={'查看图片 ' + image.name}><img src={image.url} alt={image.name} loading="lazy" /></button><label className="image-checkbox"><input type="checkbox" checked={selected.includes(image.id)} onChange={() => toggle(image.id)} aria-label={'选择图片 ' + image.name} /></label><button className={'image-star icon-button ' + (image.starred ? 'starred' : '')} aria-label={(image.starred ? '取消收藏 ' : '收藏图片 ') + image.name} onClick={() => void star(image)}><Star size={14} fill={image.starred ? 'currentColor' : 'none'} /></button>{image.visibility === 'private' && <span className="image-private"><LockKeyhole size={11} />私密</span>}</div><div className="image-card-info"><button className="image-name" onClick={() => setDetail(image)} title={image.name}>{image.name}</button><div><span>{formatBytes(image.size)} <i>·</i> {image.width && image.height ? image.width + ' × ' + image.height : image.mime.split('/')[1].toUpperCase()}</span><span>{formatDate(image.createdAt)}</span></div></div></article>)}</div> : <div className="table-scroll"><table className="data-table image-table"><thead><tr><th aria-label="选择" /><th>图片名称</th><th>可见性</th><th>文件大小</th><th>上传日期</th><th aria-label="操作" /></tr></thead><tbody>{images.map(image => <tr key={image.id}><td><input type="checkbox" aria-label={'选择图片 ' + image.name} checked={selected.includes(image.id)} onChange={() => toggle(image.id)} /></td><td><button className="table-image-name" onClick={() => setDetail(image)}><img src={image.url} alt="" loading="lazy" /><span>{image.name}{image.starred && <Star size={11} fill="currentColor" />}</span></button></td><td><span className={'badge ' + (image.visibility === 'private' ? 'neutral' : 'green')}>{image.visibility === 'private' ? '私密' : '公开'}</span></td><td>{formatBytes(image.size)}</td><td>{formatDate(image.createdAt, true)}</td><td><button className="icon-button" aria-label={'查看图片 ' + image.name} onClick={() => setDetail(image)}><Ellipsis size={17} /></button></td></tr>)}</tbody></table></div>}
    <Pagination page={page} total={total} size={40} onPage={setPage} /></section>
    <ImageDetail image={detail} albums={albums.data?.albums || []} onClose={() => setDetail(null)} onUpdate={update} onDelete={image => { setDetail(null); setDeleting([image.id]); }} />
    <Confirm open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={() => void remove()} busy={busy} title={'删除 ' + (deleting?.length || 0) + ' 张图片？'}>图片删除后，原有外链将失效。成功删除后，所占空间会归还到你的配额。</Confirm>
  </>;
}

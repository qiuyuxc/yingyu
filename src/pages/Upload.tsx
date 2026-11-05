import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CheckCheck, CircleAlert, Clipboard, CloudUpload, Copy, FolderOpen, Globe, ImagePlus, LockKeyhole, Sparkles, X } from 'lucide-react';
import type { Album, HostedImage, User } from '../../shared/types';
import { copyText, errorMessage, formatBytes, imageLink, useResource, type LinkFormat } from '../api';
import { useAuth, useToast } from '../context';
import { Button, PageHeading } from '../components/ui';
import { useProductTour } from '../components/ProductTour';

type QueueEntry = { id: string; file: File; preview: string; status: 'queued' | 'uploading' | 'done' | 'error'; progress: number; error?: string; image?: HostedImage };
function sendFile(file: File, albumId: string, visibility: string, progress: (value: number) => void, requests: Set<XMLHttpRequest>) {
  return new Promise<{ image: HostedImage; user: User }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    requests.add(request);
    const finish = () => requests.delete(request);
    request.open('POST', '/api/images'); request.timeout = 180000;
    request.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    request.onerror = () => { finish(); reject(new Error('网络连接中断，请重试')); };
    request.ontimeout = () => { finish(); reject(new Error('上传超时，请检查网络后重试')); };
    request.onabort = () => { finish(); reject(new Error('上传已取消')); };
    request.onload = () => {
      finish();
      try { const result = JSON.parse(request.responseText); if (request.status >= 200 && request.status < 300) resolve(result); else reject(new Error(result.error || '上传失败，请重试')); }
      catch { reject(new Error('服务器返回了无效响应')); }
    };
    const body = new FormData(); body.append('file', file); body.append('visibility', visibility); if (albumId) body.append('albumId', albumId);
    request.send(body);
  });
}

export function UploadPage() {
  const { user, site, refreshUser } = useAuth();
  const toast = useToast();
  const { reportUpload, notify: notifyTour } = useProductTour();
  const albums = useResource<{ albums: Album[] }>('/api/albums');
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [albumId, setAlbumId] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [format, setFormat] = useState<LinkFormat>('url');
  const fileInput = useRef<HTMLInputElement>(null);
  const previews = useRef(new Set<string>());
  const requests = useRef(new Set<XMLHttpRequest>());
  const mounted = useRef(true);
  const maxBytes = site!.settings.maxUploadBytes;
  const remaining = Math.max(0, user!.quotaBytes - user!.usedBytes - user!.reservedBytes);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; for (const url of previews.current) URL.revokeObjectURL(url); previews.current.clear(); for (const request of requests.current) request.abort(); };
  }, []);
  const addFiles = useCallback((files: File[]) => {
    if (busy) { toast('请等待当前队列上传完成后再添加图片', 'error'); return; }
    const entries: QueueEntry[] = [];
    for (const file of files) {
      if (queue.length + entries.length >= 100) { toast('每次最多添加 100 张图片', 'error'); break; }
      if (!/\.(jpe?g|png|gif|webp|avif)$/i.test(file.name) && !['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'].includes(file.type)) { toast(file.name + '：不支持的图片格式', 'error'); continue; }
      if (!file.size || file.size > maxBytes) { toast(file.name + '：图片为空或超过 ' + formatBytes(maxBytes), 'error'); continue; }
      if ([...queue, ...entries].some(entry => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified)) continue;
      const preview = URL.createObjectURL(file); previews.current.add(preview);
      entries.push({ id: crypto.randomUUID(), file, preview, status: 'queued', progress: 0 });
    }
    setQueue([...queue, ...entries]);
  }, [busy, maxBytes, queue, toast]);
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const files = Array.from(event.clipboardData?.files || []);
      if (files.length) { event.preventDefault(); addFiles(files); }
    };
    document.addEventListener('paste', paste); return () => document.removeEventListener('paste', paste);
  }, [addFiles]);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  const update = (id: string, changes: Partial<QueueEntry>) => { if (mounted.current) setQueue(items => items.map(item => item.id === id ? { ...item, ...changes } : item)); };
  const start = async () => {
    if (busy) return;
    const pending = queue.filter(item => item.status === 'queued' || item.status === 'error');
    if (!pending.length) return; setBusy(true); notifyTour('upload-started'); let index = 0, completed = 0;
    const worker = async () => {
      while (index < pending.length && mounted.current) {
        const entry = pending[index++]; update(entry.id, { status: 'uploading', progress: 0, error: undefined });
        try { const result = await sendFile(entry.file, albumId, visibility, value => update(entry.id, { progress: value }), requests.current); completed++; update(entry.id, { status: 'done', progress: 100, image: result.image }); }
        catch (err) { update(entry.id, { status: 'error', error: errorMessage(err) }); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
    if (!mounted.current) return;
    setBusy(false);
    if (completed) { toast('已收好 ' + completed + ' 张图片'); notifyTour('upload-succeeded'); }
    try { await refreshUser(); } catch (err) { toast(errorMessage(err), 'error'); }
  };
  const remove = (entry: QueueEntry) => { URL.revokeObjectURL(entry.preview); previews.current.delete(entry.preview); setQueue(items => items.filter(item => item.id !== entry.id)); };
  const copy = async (entries: QueueEntry[]) => {
    try { await copyText(entries.filter(entry => entry.image).map(entry => imageLink(entry.image!, format)).join('\n')); toast('链接已复制'); notifyTour('links-copied'); }
    catch (err) { toast(errorMessage(err), 'error'); }
  };
  const done = queue.filter(item => item.status === 'done');
  const pending = queue.filter(item => item.status === 'queued' || item.status === 'error');
  const failedCount = queue.filter(item => item.status === 'error').length;
  useEffect(() => { reportUpload({ pending: pending.length, done: done.length, failed: failedCount, busy }); }, [reportUpload, pending.length, done.length, failedCount, busy]);
  return <><PageHeading title="上传图片" action={<Link to="/app" className="button secondary">我的图片 <ArrowRight size={13} /></Link>} />
    {!site!.storageReady && <div className="inline-notice">站点暂未启用存储，请联系管理员。</div>}
    <div className="upload-layout"><div className="upload-main"><div className={'dropzone glass ' + (dragging ? 'dragging' : '')} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}>
      <span className="upload-orb"><CloudUpload size={34} strokeWidth={1.3} /><span><Sparkles size={12} /></span></span><h2>{dragging ? '松开即可添加图片' : '把你的图片，轻轻放在这里'}</h2><p>拖拽图片到此处，或点击下方按钮选择</p><Button data-tour="upload-choose" disabled={busy} onClick={() => fileInput.current?.click()}><ImagePlus size={14} />选择图片</Button><input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,image/avif" className="visually-hidden" aria-label="选择上传图片" onChange={event => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} /><div className="dropzone-formats"><span>JPG</span><span>PNG</span><span>GIF</span><span>WebP</span><span>AVIF</span><i>单张不超过 {formatBytes(maxBytes)}</i></div><small><Clipboard size={11} />也支持 Ctrl / ⌘ + V 粘贴图片</small>
    </div>{queue.length > 0 && <section className="upload-queue glass"><div className="panel-heading"><div><h3>上传队列 <span>{queue.length}</span></h3><p>{done.length} 张已完成{busy ? ' · 请保持此页面打开' : ''}</p></div><Button data-tour="upload-start" variant="primary" disabled={!pending.length || !site!.storageReady} busy={busy} onClick={() => void start()}>{pending.some(item => item.status === 'error') ? '上传 / 重试' : '开始上传'}{!busy && <CloudUpload size={13} />}</Button></div><div className="queue-list">{queue.map(entry => <div className={'queue-row ' + entry.status} key={entry.id}><img src={entry.preview} alt={entry.file.name} /><div className="queue-info"><strong title={entry.file.name}>{entry.file.name}</strong><span>{formatBytes(entry.file.size)} <i>·</i> {entry.status === 'queued' ? '等待上传' : entry.status === 'uploading' ? entry.progress === 100 ? '正在写入存储…' : entry.progress + '%' : entry.status === 'done' ? '上传完成' : entry.error}</span>{entry.status === 'uploading' && <div className="progress-track"><span style={{ width: entry.progress + '%' }} /></div>}</div><div className="queue-actions">{entry.status === 'done' ? <><Check size={16} /><button className="icon-button" aria-label={'复制链接 ' + entry.file.name} onClick={() => void copy([entry])}><Copy size={14} /></button></> : entry.status === 'error' ? <CircleAlert size={15} /> : null}{!busy && <button className="icon-button" aria-label={'从队列移除 ' + entry.file.name} onClick={() => remove(entry)}><X size={14} /></button>}</div></div>)}</div></section>}
    {done.length > 0 && <section data-tour="upload-copy" className="upload-results glass"><div className="panel-heading"><div><h3><CheckCheck size={16} />上传完成</h3><p>选择格式，一次复制所有成功上传的链接。</p></div><Button onClick={() => void copy(done)}><Copy size={13} />复制全部链接</Button></div><div className="segmented link-formats">{(['url', 'markdown', 'html', 'bbcode'] as LinkFormat[]).map(value => <button key={value} className={value === format ? 'selected' : ''} onClick={() => setFormat(value)}>{value === 'url' ? '图片直链' : value === 'markdown' ? 'Markdown' : value.toUpperCase()}</button>)}</div><textarea readOnly rows={Math.min(6, done.length + 1)} aria-label="成功上传的图片链接" value={done.map(entry => imageLink(entry.image!, format)).join('\n')} />{done.some(entry => entry.image?.visibility === 'private') && <p className="private-note"><LockKeyhole size={12} />队列中包含私密图片，访问这些链接需要登录。</p>}</section>}</div>
    <aside className="upload-settings glass"><div className="panel-heading"><h3>上传设置</h3></div><label className="form-label">保存到相册<select disabled={busy || albums.loading || Boolean(albums.error)} value={albumId} onChange={event => setAlbumId(event.target.value)}><option value="">不分相册</option>{albums.data?.albums.map(album => <option key={album.id} value={album.id}>{album.name}</option>)}</select></label>{albums.error && <p className="form-error">{albums.error}</p>}<Link to="/app/albums" className="settings-link"><FolderOpen size={12} />管理我的相册<ArrowRight size={11} /></Link><span className="field-caption visibility-caption">图片可见性</span><div data-tour="upload-visibility" className="visibility-options"><button disabled={busy} className={visibility === 'public' ? 'selected' : ''} aria-pressed={visibility === 'public'} onClick={() => { setVisibility('public'); notifyTour('visibility-chosen'); }}><Globe size={16} /><span><strong>公开</strong><small>可通过外链分享</small></span>{visibility === 'public' && <Check size={13} />}</button><button disabled={busy} className={visibility === 'private' ? 'selected' : ''} aria-pressed={visibility === 'private'} onClick={() => { setVisibility('private'); notifyTour('visibility-chosen'); }}><LockKeyhole size={16} /><span><strong>私密</strong><small>仅自己和管理员可见</small></span>{visibility === 'private' && <Check size={13} />}</button></div><div className="upload-remaining"><span>当前可用空间</span><strong>{formatBytes(remaining)}</strong><div className="progress-track"><span style={{ width: (user!.quotaBytes ? Math.min(100, user!.usedBytes / user!.quotaBytes * 100) : 100) + '%' }} /></div><Link to="/app/quota">空间不够？申请扩容 <ArrowRight size={11} /></Link></div><p className="upload-tips"><Sparkles size={13} />上传会占用存储配额；成功删除图片后，空间会自动归还。</p></aside></div>
  </>;
}

import { useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, ExternalLink, LockKeyhole, Star } from 'lucide-react';
import type { Album, HostedImage } from '../../shared/types';
import { api, copyText, errorMessage, formatBytes, formatDate, imageLink, type LinkFormat } from '../api';
import { useToast } from '../context';
import { Button, Dialog } from './ui';

export function ImageDetail({ image, albums, onClose, onUpdate, onDelete }: { image: HostedImage | null; albums: Album[]; onClose: () => void; onUpdate: (image: HostedImage) => void; onDelete: (image: HostedImage) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [albumId, setAlbumId] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [format, setFormat] = useState<LinkFormat>('url');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (image) { setName(image.name); setAlbumId(image.albumId || ''); setVisibility(image.visibility); setCopied(false); } }, [image]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!image) return; setBusy(true);
    try { const result = await api<{ image: HostedImage }>('/api/images/' + image.id, { method: 'PATCH', body: { name, albumId: albumId || null, visibility } }); onUpdate(result.image); toast('图片信息已更新'); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!image) return;
    try { await copyText(imageLink(image, format)); setCopied(true); toast('链接已复制'); setTimeout(() => setCopied(false), 2000); }
    catch (err) { toast(errorMessage(err), 'error'); }
  };
  const star = async () => {
    if (!image) return; setBusy(true);
    try { const result = await api<{ image: HostedImage }>('/api/images/' + image.id, { method: 'PATCH', body: { starred: !image.starred } }); onUpdate(result.image); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  return <Dialog open={Boolean(image)} onClose={busy ? () => {} : onClose} title="图片详情" wide>{image && <div className="image-detail-layout"><div className="detail-preview"><img src={image.url} alt={image.name} /><div><span>{image.width && image.height ? image.width + ' × ' + image.height : image.mime.split('/')[1].toUpperCase()}</span><span>{formatBytes(image.size)}</span></div></div><div className="detail-panel"><form className="form-stack" onSubmit={save}><label>图片名称<input value={name} required maxLength={200} onChange={event => setName(event.target.value)} /></label><label>所在相册<select value={albumId} onChange={event => setAlbumId(event.target.value)}><option value="">未归档</option>{albums.map(album => <option value={album.id} key={album.id}>{album.name}</option>)}</select></label><label>可见性<select value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)}><option value="public">公开 · 可通过外链分享</option><option value="private">私密 · 仅自己和管理员可见</option></select></label><div className="detail-save"><Button variant="primary" busy={busy} type="submit">保存修改</Button><Button disabled={busy} onClick={star} type="button" aria-label={image.starred ? '取消收藏' : '收藏图片'}><Star size={14} fill={image.starred ? 'currentColor' : 'none'} /></Button></div></form><div className="detail-link"><span className="field-caption">分享链接</span><div className="segmented">{(['url', 'markdown', 'html', 'bbcode'] as LinkFormat[]).map(value => <button key={value} onClick={() => { setFormat(value); setCopied(false); }} className={format === value ? 'selected' : ''}>{value === 'url' ? '直链' : value === 'markdown' ? 'Markdown' : value.toUpperCase()}</button>)}</div><textarea readOnly value={imageLink(image, format)} aria-label="图片分享链接" rows={3} /><Button className="full-width" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}复制链接</Button>{image.visibility === 'private' && <p className="private-note"><LockKeyhole size={12} />私密链接需要登录，公开分享前请修改可见性。</p>}</div><dl className="detail-meta"><div><dt>存储位置</dt><dd>{image.storageName}</dd></div><div><dt>上传时间</dt><dd>{formatDate(image.createdAt, true)}</dd></div><div><dt>文件格式</dt><dd>{image.mime}</dd></div></dl><div className="detail-bottom"><a href={image.url} target="_blank" rel="noreferrer"><ExternalLink size={12} />查看原图</a><button className="text-danger" disabled={busy} onClick={() => onDelete(image)}>删除图片</button></div></div></div>}</Dialog>;
}

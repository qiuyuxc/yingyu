import { useEffect, useState, type FormEvent } from 'react';
import { Edit3, Eye, Megaphone, Plus, Save, Trash2 } from 'lucide-react';
import type { Announcement } from '../../shared/types';
import { api, errorMessage, formatDate, useResource } from '../api';
import { useAuth, useToast } from '../context';
import { AnnouncementCard } from '../components/AnnouncementDialog';
import { Button, Confirm, Dialog, EmptyState, ErrorState, Loading, PageHeading, Pagination, Switch } from '../components/ui';

type AnnouncementList = { announcements: Announcement[]; total: number };
type EditAnnouncement = Pick<Announcement, 'title' | 'content' | 'popup' | 'status'> & Partial<Pick<Announcement, 'id' | 'revision'>>;
const emptyAnnouncement: EditAnnouncement = { title: '', content: '', popup: true, status: 'draft' };

export function AnnouncementsPage() {
  const [page, setPage] = useState(1);
  const resource = useResource<AnnouncementList>('/api/announcements?page=' + page);
  const [selected, setSelected] = useState<Announcement | null>(null);
  return <><PageHeading title="公告中心" />
    {resource.loading ? <Loading /> : resource.error ? <ErrorState error={resource.error} retry={resource.refresh} /> : !resource.data?.announcements.length ? <EmptyState icon={<Megaphone size={27} />} title="暂时没有公告" description="站点发布的新消息会保存在这里，方便随时查看。" /> : <div className="announcement-list">{resource.data.announcements.map(item => <article key={item.id} className="announcement-entry glass"><div className="announcement-entry-heading"><span className="announcement-entry-icon"><Megaphone size={18} /></span><div><h2>{item.title}</h2><small>{formatDate(item.publishedAt || item.createdAt, true)}</small></div></div><p>{item.content}</p><Button onClick={() => setSelected(item)}>阅读全文</Button></article>)}</div>}
    <Pagination page={page} total={resource.data?.total || 0} size={20} onPage={setPage} />
    <AnnouncementCard open={Boolean(selected)} title={selected?.title || '站点公告'} content={selected?.content || ''} date={selected?.publishedAt} onClose={() => setSelected(null)} />
  </>;
}

export function AdminAnnouncementsPage() {
  const { site, refreshSite } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const resource = useResource<AnnouncementList>('/api/admin/announcements?page=' + page);
  const [banner, setBanner] = useState(site?.settings.announcement || '');
  const [bannerBusy, setBannerBusy] = useState(false);
  const [editing, setEditing] = useState<EditAnnouncement | null>(null);
  const [preview, setPreview] = useState<EditAnnouncement | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setBanner(site?.settings.announcement || ''); }, [site?.settings.announcement]);
  const saveBanner = async (event: FormEvent) => {
    event.preventDefault(); setBannerBusy(true);
    try { await api('/api/admin/announcement-banner', { method: 'PATCH', body: { announcement: banner } }); await refreshSite(); toast('横条公告已保存'); }
    catch (error) { toast(errorMessage(error), 'error'); } finally { setBannerBusy(false); }
  };
  const save = async (status: Announcement['status']) => {
    if (!editing) return;
    setBusy(true);
    try {
      await api('/api/admin/announcements' + (editing.id ? '/' + editing.id : ''), { method: editing.id ? 'PATCH' : 'POST', body: { ...editing, status } });
      setEditing(null); setPage(1); resource.refresh(); toast(status === 'published' ? '公告已发布' : '公告已保存为草稿');
    } catch (error) { toast(errorMessage(error), 'error'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try { await api('/api/admin/announcements/' + deleting.id, { method: 'DELETE' }); setDeleting(null); if (resource.data?.announcements.length === 1 && page > 1) setPage(page - 1); else resource.refresh(); toast('公告已删除'); }
    catch (error) { toast(errorMessage(error), 'error'); } finally { setBusy(false); }
  };
  const canSave = Boolean(editing?.title.trim() && editing?.content.trim());
  return <><PageHeading title="公告管理" action={<Button variant="primary" onClick={() => setEditing({ ...emptyAnnouncement })}><Plus size={14} />新建公告</Button>} />
    <section className="settings-panel glass announcement-banner-settings"><div className="panel-heading"><div><h3>图片页横条公告</h3><p>显示在“我的图片”页，留空即可隐藏。</p></div></div><form className="form-stack" onSubmit={saveBanner}><label htmlFor="announcement-banner">横条内容</label><textarea id="announcement-banner" aria-label="横条内容" rows={2} maxLength={500} value={banner} onChange={event => setBanner(event.target.value)} /><Button type="submit" busy={bannerBusy}><Save size={13} />保存横条公告</Button></form></section>
    <section className="announcement-management"><div className="panel-heading"><div><h3>公告列表</h3><p>已发布的公告会进入用户的公告中心。登录后仅弹出最新一条启用弹窗的公告。</p></div></div>
      {resource.loading ? <Loading /> : resource.error ? <ErrorState error={resource.error} retry={resource.refresh} /> : !resource.data?.announcements.length ? <EmptyState icon={<Megaphone size={27} />} title="还没有公告" description="新建一条公告，可以先保存草稿，准备好后再发布。" /> : <div className="announcement-list">{resource.data.announcements.map(item => <article key={item.id} className="announcement-entry glass"><div className="announcement-entry-heading"><div><h2>{item.title}</h2><small>更新于 {formatDate(item.updatedAt, true)}</small></div><span className={'badge ' + (item.status === 'published' ? 'green' : 'neutral')}>{item.status === 'published' ? '已发布' : '草稿'}</span>{item.popup && <span className="badge neutral">登录后弹窗</span>}</div><p>{item.content}</p><div className="announcement-entry-actions"><Button aria-label={'编辑公告 ' + item.title} onClick={() => setEditing({ ...item })}><Edit3 size={13} />编辑</Button><Button aria-label={'预览公告 ' + item.title} onClick={() => setPreview({ ...item })}><Eye size={13} />预览</Button><Button variant="ghost" aria-label={'删除公告 ' + item.title} onClick={() => setDeleting(item)}><Trash2 size={13} />删除</Button></div></article>)}</div>}
      <Pagination page={page} total={resource.data?.total || 0} size={20} onPage={setPage} />
    </section>
    <Dialog open={Boolean(editing)} onClose={busy ? () => {} : () => setEditing(null)} title={editing?.id ? '编辑公告' : '新建公告'} wide>{editing && <form className="form-stack" onSubmit={event => { event.preventDefault(); void save('published'); }}><label>公告标题<input required maxLength={80} value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} /></label><label>公告正文<textarea required rows={9} maxLength={10000} value={editing.content} onChange={event => setEditing({ ...editing, content: event.target.value })} /></label><div className="setting-row"><div><strong>登录后弹出</strong><p>仅对已登录用户展示。选择“不再弹出”后记住本条公告，内容更新时再次提醒。</p></div><Switch label="登录后弹出" checked={editing.popup} onChange={popup => setEditing({ ...editing, popup })} /></div><div className="dialog-actions announcement-editor-actions"><Button type="button" disabled={!canSave || busy} onClick={() => setPreview({ ...editing })}><Eye size={13} />预览</Button><Button type="button" disabled={!canSave || busy} onClick={() => void save('draft')}>{editing.status === 'published' ? '撤回为草稿' : '保存草稿'}</Button><Button type="submit" variant="primary" disabled={!canSave} busy={busy}>{editing.status === 'published' ? '保存并发布' : '发布公告'}</Button></div></form>}</Dialog>
    <AnnouncementCard open={Boolean(preview)} title={preview?.title || '公告预览'} content={preview?.content || ''} onClose={() => setPreview(null)} />
    <Confirm open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={() => void remove()} busy={busy} title="删除这条公告？">删除“{deleting?.title}”后，用户将无法在公告中心查看它。</Confirm>
  </>;
}

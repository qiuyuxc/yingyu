import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ClipboardCheck, CloudUpload, HardDrive, Images, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react';
import type { AdminOverview } from '../../shared/types';
import { api, errorMessage, formatBytes, formatDate, useResource } from '../api';
import { useToast } from '../context';
import { Button, Confirm, EmptyState, ErrorState, Loading, PageHeading } from '../components/ui';

type PendingImage = { id: string; name: string; state: string; size: number; createdAt: string; stateChangedAt: string; ownerName: string; storageName: string };
const actionNames: Record<string, string> = {
  'account.register': '用户注册', 'account.password': '密码更新', 'site.initialize': '站点初始化',
  'quota.grant': '额度调配', 'quota.request': '扩容申请', 'quota.review': '扩容审核',
  'image.delete': '图片删除', 'user.update': '用户资料更新', 'storage.create': '新增存储',
  'storage.update': '存储配置更新', 'storage.activate': '切换默认存储', 'storage.delete': '删除存储',
  'storage.cleanup': '清理未完成任务', 'storage.cleanup.pending': '上传清理待重试',
  'storage.test.cleanup': '连接测试待清理', 'site.settings': '站点设置更新',
};
export function AdminOverviewPage() {
  const resource = useResource<AdminOverview>('/api/admin/overview');
  const maintenance = useResource<{ pending: PendingImage[] }>('/api/admin/maintenance');
  const toast = useToast();
  const [cleaning, setCleaning] = useState<PendingImage | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => { resource.refresh(); maintenance.refresh(); };
  const cleanup = async () => {
    if (!cleaning) return; setBusy(true);
    try { await api('/api/admin/maintenance/' + cleaning.id + '/cleanup', { method: 'POST' }); setCleaning(null); refresh(); toast('任务已清理，占用空间已归还'); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  const data = resource.data;
  return <><PageHeading title="站点概览" action={<Button onClick={refresh}><RefreshCw size={13} />刷新数据</Button>} />
    {resource.loading ? <Loading /> : resource.error ? <ErrorState error={resource.error} retry={resource.refresh} /> : data && <><div className="admin-stats">{[
      { label: '注册用户', value: data.users.toLocaleString(), sub: '已注册账号', icon: Users, color: 'mint' },
      { label: '图片总数', value: data.images.toLocaleString(), sub: '今日上传 ' + data.uploadsToday + ' 张', icon: Images, color: 'lilac' },
      { label: '存储用量', value: formatBytes(data.usedBytes), sub: '已分配 ' + formatBytes(data.quotaBytes), icon: HardDrive, color: 'peach' },
      { label: '待处理申请', value: data.pendingRequests.toLocaleString(), sub: '等待审核的扩容申请', icon: ClipboardCheck, color: 'butter' },
    ].map(({ label, value, sub, icon: Icon, color }) => <article className="admin-stat glass" key={label}><div><span>{label}</span><span className={'stat-icon ' + color}><Icon size={17} /></span></div><strong>{value}</strong><small>{sub}</small></article>)}</div><div className="admin-overview-grid"><section className="chart-panel glass"><div className="panel-heading"><div><h3>近七日上传</h3><p>当前保留的图片 · 按 UTC 日期统计</p></div><span className="badge green"><CloudUpload size={11} />{data.dailyUploads.reduce((sum, day) => sum + day.count, 0)} 张</span></div><div className="upload-chart" role="img" aria-label={data.dailyUploads.map(day => day.date + '：' + day.count + ' 张').join('，')}>{data.dailyUploads.map(day => <div className="chart-column" key={day.date} title={day.date + ' · ' + day.count + ' 张 · ' + formatBytes(day.bytes)}><span>{day.count}</span><div className="chart-bar-track"><div style={{ height: (day.count ? Math.max(4, day.count / Math.max(1, ...data.dailyUploads.map(item => item.count)) * 100) : 0) + '%' }} /></div><small>{day.date.slice(5).replace('-', '/')}</small></div>)}</div></section><section className="admin-quick-panel glass"><h2>常用操作</h2><Link to="/admin/requests"><span className="stat-icon mint"><ClipboardCheck size={16} /></span><span><strong>审核扩容申请</strong><small>{data.pendingRequests ? data.pendingRequests + ' 条待处理' : '所有申请都已处理'}</small></span><ArrowRight size={14} /></Link><Link to="/admin/storage"><span className="stat-icon lilac"><HardDrive size={16} /></span><span><strong>管理存储连接</strong><small>S3 · R2 · WebDAV · 本地</small></span><ArrowRight size={14} /></Link></section></div><section className="audit-panel glass"><div className="panel-heading"><div><h3>最近动态</h3><p>保留管理操作记录，便于追溯。</p></div></div>{!data.recentAudit.length ? <EmptyState icon={<ShieldCheck size={24} />} title="暂时没有动态" description="管理操作会记录在这里。" /> : <div className="audit-list">{data.recentAudit.map(entry => <div key={entry.id}><span className="audit-dot"><Check size={11} /></span><div><strong>{entry.actor}</strong><span>{actionNames[entry.action] || entry.action}</span></div><time dateTime={entry.createdAt}>{formatDate(entry.createdAt, true)}</time></div>)}</div>}</section></>}
    <section className="maintenance-panel glass"><div className="panel-heading"><div><h3>未完成任务</h3><p>处理中断的上传或删除，可在任务停止后清理并归还空间。</p></div></div>{maintenance.loading ? <Loading /> : maintenance.error ? <ErrorState error={maintenance.error} retry={maintenance.refresh} /> : !maintenance.data?.pending.length ? <div className="all-clear"><ShieldCheck size={16} />一切正常，没有需要清理的任务。</div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>图片</th><th>用户 / 存储</th><th>空间</th><th>状态</th><th>操作</th></tr></thead><tbody>{maintenance.data.pending.map(item => <tr key={item.id}><td>{item.name}<small className="table-subtext">{formatDate(item.stateChangedAt, true)}</small></td><td>{item.ownerName}<small className="table-subtext">{item.storageName}</small></td><td>{formatBytes(item.size)}</td><td><span className="badge amber">{item.state === 'uploading' ? '上传未完成' : '删除未完成'}</span></td><td><Button disabled={Date.now() - Date.parse(item.stateChangedAt) < 600000} onClick={() => setCleaning(item)} title="任务停止超过 10 分钟后才可清理"><Trash2 size={12} />清理</Button></td></tr>)}</tbody></table></div>}</section>
    <Confirm open={Boolean(cleaning)} onClose={() => setCleaning(null)} onConfirm={() => void cleanup()} busy={busy} title="清理这个未完成任务？">系统会尝试删除存储中的对象。删除成功后，记录和占用空间一并清理。</Confirm>
  </>;
}

import { useRef, useState } from 'react';
import { ImagePlus, Trash2, RotateCcw } from 'lucide-react';
import type { AvatarEntry, AvatarLibrary } from '../../shared/types';
import { api, errorMessage, formatBytes, useResource } from '../api';
import { useAuth, useToast } from '../context';
import { Avatar } from './Avatar';
import { Button, Confirm, ErrorState, Loading, Switch } from './ui';

export function AvatarSettings() {
  const {user,setUser}=useAuth();
  const resource=useResource<AvatarLibrary>('/api/account/avatars');
  const toast=useToast();
  const input=useRef<HTMLInputElement>(null);
  const [busy,setBusy]=useState(false);
  const [deleting,setDeleting]=useState<AvatarEntry|null>(null);
  const data=resource.data;
  const perform=async(path:string,method:string,body?:unknown)=>{
    setBusy(true);
    try {
      const result=await api<AvatarLibrary>('/api/account/avatars'+path,{method,body});
      setUser(result.user);setDeleting(null);resource.refresh();
      toast(result.pendingDeletes?'头像已更新，待清理文件会自动重试；空间在删除成功后归还':'头像设置已更新');
    } catch(error) {toast(errorMessage(error),'error');resource.refresh();}
    finally {setBusy(false);if(input.current)input.current.value='';}
  };
  const upload=(file?:File)=>{
    if(!file)return;
    if(file.size>5*1024**2){toast('头像大小不能超过 5 MB','error');return;}
    const form=new FormData();form.set('file',file);void perform('','POST',form);
  };
  return <section id="avatar-settings" className="settings-panel glass avatar-settings-panel"><div className="panel-heading"><h3>头像与头像库</h3></div>
    <div className="avatar-current"><Avatar name={user!.name} url={user?.avatarUrl} className="avatar-large" /><div><strong>当前头像 · 免费</strong><p>支持 JPG、PNG、GIF、WebP、AVIF，最大 5 MB。</p><div><Button busy={busy} disabled={resource.loading} onClick={()=>input.current?.click()}><ImagePlus size={14} />上传新头像</Button>{data?.current&&<Button disabled={busy} variant="ghost" onClick={()=>setDeleting(data.current)}>移除当前头像</Button>}</div></div><input ref={input} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif" aria-label="选择头像图片" disabled={busy} onChange={event=>upload(event.target.files?.[0])} /></div>
    {resource.loading&&!data?<Loading />:resource.error?<ErrorState error={resource.error} retry={resource.refresh} />:data&&<>
      <div className="setting-row"><div><strong>开启头像库</strong><p>替换头像时保留原头像，历史头像占用存储配额。最多保存 10 个历史头像，加上当前头像共 11 个。</p></div><Switch label="开启头像库" checked={data.enabled} disabled={busy} onChange={enabled=>void perform('/library','PATCH',{enabled})} /></div>
      {!data.enabled&&data.expiresAt&&data.history.length>0&&<p className="inline-notice">头像库已关闭，历史头像保留至 {new Date(data.expiresAt).toLocaleString('zh-CN')}，随后删除并归还额度。到期前重新开启可继续保留。</p>}
      {!data.enabled&&!data.expiresAt&&<p className="panel-description">关闭时，之后被替换的当前头像会直接删除；启用后才会保留。</p>}
      {data.pendingDeletes>0&&<div className="inline-notice"><p>有 {data.pendingDeletes} 个头像等待存储清理，空间将在删除成功后归还。</p><Button busy={busy} onClick={()=>void perform('/cleanup','POST')}><RotateCcw size={13} />重试清理</Button></div>}
      <div className="avatar-library-heading"><strong>历史头像 {data.history.length} / 10</strong><span>占用 {formatBytes(data.history.reduce((sum,entry)=>sum+entry.size,0))}</span></div>
      {data.history.length?<div className="avatar-library-grid">{data.history.map(entry=><article className="avatar-library-item" key={entry.id}><img src={entry.url} alt={entry.name} /><span title={entry.name}>{entry.name}</span><small>{formatBytes(entry.size)}</small><div><Button disabled={busy} onClick={()=>void perform('/'+entry.id+'/select','POST')} aria-label={'使用头像 '+entry.name}>使用</Button><Button variant="ghost" disabled={busy} aria-label={'删除历史头像 '+entry.name} onClick={()=>setDeleting(entry)}><Trash2 size={13} /></Button></div></article>)}</div>:<p className="token-empty">暂无历史头像。</p>}
    </>}
    <Confirm open={Boolean(deleting)} onClose={()=>setDeleting(null)} onConfirm={()=>void perform('/'+deleting!.id,'DELETE')} busy={busy} title="删除这个头像？">{deleting?.id===data?.current?.id?'删除后恢复为名字首字头像。':'删除成功后，将归还 '+formatBytes(deleting?.size||0)+' 配额。'}</Confirm>
  </section>;
}

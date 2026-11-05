import { useId, useState } from 'react';
import type { AdminOverview } from '../../shared/types';
import { formatBytes } from '../api';

export function UploadTrend({ days }: { days: AdminOverview['dailyUploads'] }) {
  const [selected, setSelected] = useState(days.length - 1);
  const [metric, setMetric] = useState<'count'|'bytes'>('count');
  const gradient=useId();
  const peak=Math.max(1,...days.map(day=>day[metric]));
  const maximum=metric==='count'?Math.max(4,Math.ceil(peak/4)*4):peak;
  const points=days.map((day,index)=>({x:44+index*480/Math.max(1,days.length-1),y:160-day[metric]/maximum*135}));
  const line=points.map((point,index)=>(index?'L':'M')+point.x+','+point.y).join(' ');
  const chosen=days[selected]||days[days.length-1];
  if(!chosen) return null;
  return <div className="upload-trend">
    <div className="trend-toolbar"><div className="segmented" aria-label="统计指标"><button type="button" aria-pressed={metric==='count'} className={metric==='count'?'selected':''} onClick={()=>setMetric('count')}>图片数</button><button type="button" aria-pressed={metric==='bytes'} className={metric==='bytes'?'selected':''} onClick={()=>setMetric('bytes')}>上传量</button></div><span>{metric==='count'?'单位：张':'单位：字节'}</span></div>
    <svg viewBox="0 0 560 180" className="trend-svg" role="group" aria-label="近七日上传折线图">
      <defs><linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".22" /><stop offset="100%" stopColor="var(--accent)" stopOpacity=".01" /></linearGradient></defs>
      {[0,.5,1].map(fraction=><g key={fraction}><line x1="44" x2="524" y1={160-fraction*135} y2={160-fraction*135} stroke="var(--line)" strokeDasharray="3 5" /><text x="36" y={164-fraction*135} textAnchor="end" fill="var(--muted)" fontSize="10">{metric==='count'?maximum*fraction:formatBytes(maximum*fraction,0)}</text></g>)}
      <path d={line+` L${points[points.length-1].x},160 L44,160 Z`} fill={`url(#${gradient})`} />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
      <line x1={points[selected]?.x} x2={points[selected]?.x} y1="20" y2="160" stroke="var(--accent)" opacity=".3" strokeDasharray="4 4" />
      {points.map((point,index)=><g key={days[index].date} role="button" tabIndex={0} aria-label={`${days[index].date}：${days[index].count} 张，${formatBytes(days[index].bytes)}`} aria-pressed={selected===index} onClick={()=>setSelected(index)} onMouseEnter={()=>setSelected(index)} onFocus={()=>setSelected(index)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelected(index);}}}><circle cx={point.x} cy={point.y} r="15" fill="transparent" /><circle cx={point.x} cy={point.y} r={selected===index?5:3.5} fill={selected===index?'var(--accent)':'var(--panel)'} stroke="var(--accent)" strokeWidth="2" /></g>)}
    </svg>
    <div className="trend-dates">{days.map((day,index)=><button type="button" key={day.date} aria-label={'查看 '+day.date+' 上传数据'} aria-pressed={selected===index} className={selected===index?'selected':''} onClick={()=>setSelected(index)}>{day.date.slice(5).replace('-','/')}</button>)}</div>
    <output className="trend-detail" aria-live="polite"><span>{chosen.date}</span><strong>{chosen.count} 张图片</strong><span>{formatBytes(chosen.bytes)}</span></output>
  </div>;
}

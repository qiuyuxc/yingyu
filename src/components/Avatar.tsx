import { useEffect, useState } from 'react';

export function Avatar({ name, url, className='' }: { name:string;url?:string|null;className?:string }) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[url]);
  return <span className={'avatar '+className}>{url&&!failed?<img src={url} alt={name+'的头像'} onError={()=>setFailed(true)} />:name.slice(0,1).toUpperCase()}</span>;
}

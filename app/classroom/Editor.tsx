import {useEffect,useRef,useState} from 'react';
import {assetURL,type Hotspot,type Media} from './data';
type Props={hotspot:Hotspot;muted:boolean;onSave:(h:Hotspot)=>void;onMove:()=>void;onDelete:()=>void;onGallery:()=>void};
export default function Editor({hotspot,muted,onSave,onMove,onDelete,onGallery}:Props){
 const [draft,setDraft]=useState<Hotspot>(hotspot),[path,setPath]=useState(''),[type,setType]=useState<Media['type']>('image'),[error,setError]=useState(''),[preview,setPreview]=useState<{url:string;type:string}|null>(null);
 const latest=useRef(onSave);latest.current=onSave;const touched=useRef(false);
 const draftRef=useRef(draft);draftRef.current=draft;
 const previewContainer=useRef<HTMLDetailsElement>(null);
 useEffect(()=>()=>{if(touched.current)latest.current({...draftRef.current,title:draftRef.current.title.trim()||'待补充回忆'})},[]);
 useEffect(()=>{setDraft(hotspot);touched.current=false},[hotspot.id]);
 useEffect(()=>{if(!touched.current)return;const timer=setTimeout(()=>latest.current({...draft,title:draft.title.trim()||'待补充回忆'}),300);return()=>clearTimeout(timer)},[draft]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url)},[preview]);
 useEffect(()=>{const media=previewContainer.current?.querySelectorAll('video,audio');function stop(){media?.forEach(el=>(el as HTMLMediaElement).pause())}window.document.addEventListener('visibilitychange',stop);return()=>{stop();window.document.removeEventListener('visibilitychange',stop)}},[preview]);
 function update(patch:Partial<Hotspot>){touched.current=true;setDraft(value=>({...value,...patch}))}
 function save(){latest.current({...draft,title:draft.title.trim()||'待补充回忆'});setError('')}
 function addMedia(){try{assetURL(path);update({media:[...draft.media,{id:crypto.randomUUID(),type,src:path.trim(),caption:'',date:''}]});setPath('');setError('')}catch(e){setError((e as Error).message)}}
 function mediaChange(id:string,patch:Partial<Media>){update({media:draft.media.map(m=>m.id===id?{...m,...patch}:m)})}
 return <div className="cl-editor">
  <p className="cl-eyebrow">把记忆留在这里</p><h2>编辑空间热点</h2><p className="cl-muted">修改自动存为本机草稿。位置来自你点击的模型表面。</p>
  <label>标题<input aria-label="热点标题" maxLength={100} value={draft.title} onChange={e=>update({title:e.target.value})}/></label>
  <div className="cl-two"><label>时间<input aria-label="热点时间" type="text" placeholder="YYYY-MM" value={draft.date.slice(0,7)} onChange={e=>update({date:e.target.value})}/></label><label>标签（逗号分隔）<input aria-label="热点标签" value={draft.tags.join(', ')} onChange={e=>update({tags:e.target.value.split(/[,，]/).map(t=>t.trim()).filter(Boolean).slice(0,30)})}/></label></div>
  <label>描述<textarea aria-label="热点描述" rows={4} maxLength={20000} placeholder="待补充回忆，不会自动生成你的故事。" value={draft.description} onChange={e=>update({description:e.target.value})}/></label>
  <div className="cl-coordinate">模型坐标 {draft.position.map(n=>n.toFixed(3)).join(' / ')}</div>
  <button onClick={()=>{save();onMove()}}>重新点选位置</button>
  <h3>相册与时间胶囊 <span>{draft.media.length}</span></h3>
  {draft.media.map((m,i)=><div className="cl-media-row" key={m.id}>
   <div className="cl-between"><b>{String(i+1).padStart(2,'0')} · {m.type==='image'?'照片':m.type==='video'?'视频':'录音'}</b><button className="cl-text-button" aria-label={`移除媒体 ${i+1}`} onClick={()=>update({media:draft.media.filter(x=>x.id!==m.id)})}>移除</button></div>
   <p className="cl-path">{m.src}</p>{m.type==='image'&&<img className="cl-thumbnail" src={assetURL(m.src)} loading="lazy" alt={m.caption||'照片预览'} onError={e=>{e.currentTarget.style.display='none';setError('媒体预览失败，请确认文件已经放入 public/ 下且路径正确')}}/>}
   <label>这条记忆的时间<input aria-label={`媒体 ${i+1} 日期`} type="text" placeholder="YYYY-MM-DD" value={m.date} onChange={e=>mediaChange(m.id,{date:e.target.value})}/></label><label>说明<input aria-label={`媒体 ${i+1} 说明`} maxLength={1000} value={m.caption} onChange={e=>mediaChange(m.id,{caption:e.target.value})}/></label>
  </div>)}
  <div className="cl-add-media"><label>资源类型<select aria-label="添加媒体类型" value={type} onChange={e=>setType(e.target.value as Media['type'])}><option value="image">照片</option><option value="video">视频</option><option value="audio">录音</option></select></label><label>项目内媒体路径<input aria-label="媒体资源路径" placeholder="memories/desk/photo-01.jpg" value={path} onChange={e=>setPath(e.target.value)}/></label><button onClick={addMedia}>添加到相册</button><p className="cl-muted">把文件放入项目 public/memories/，再填 memories/…；也可使用已授权的 HTTPS 媒体地址。</p></div>
  <details ref={previewContainer}><summary>本地文件临时预览</summary><p className="cl-muted">此文件仅在当前页面预览。刷新后需要重新选择；不会写入草稿、导出 JSON 或 GitHub。正式发布请使用上面的资源路径。</p><input type="file" aria-label="临时预览文件" accept="image/*,video/*,audio/*" onChange={e=>{const file=e.target.files?.[0];if(file){if(file.size>200*1024*1024){setError('临时预览文件请小于 200 MB');return}setPreview({url:URL.createObjectURL(file),type:file.type})}}}/>{preview&&(preview.type.startsWith('image/')?<img className="cl-thumbnail" src={preview.url} alt="仅临时预览"/>:preview.type.startsWith('video/')?<video key={preview.url} src={preview.url} controls muted={muted} playsInline/>:<audio key={preview.url} src={preview.url} controls muted={muted}/>)}</details>
  {error&&<p role="alert" className="cl-error">{error}</p>}
  <div className="cl-panel-actions"><button className="cl-primary" onClick={save}>保存热点</button><button onClick={()=>{save();onGallery()}}>预览相册</button></div><button className="cl-danger" onClick={onDelete}>删除这个热点</button>
 </div>;
}

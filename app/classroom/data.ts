import {Matrix4,Vector3} from 'three';
export type Point=[number,number,number];
export type Media={id:string;type:'image'|'video'|'audio';src:string;caption:string;date:string};
export type Hotspot={id:string;title:string;description:string;date:string;position:Point;tags:string[];media:Media[]};
export type HotspotDocument={schemaVersion:1;spaceId:'classroom';coordinateSpace:'model-local';hotspots:Hotspot[]};
export type Navigation={x0:number;z0:number;resolution:number;width:number;height:number;cells:number[];floorY:number;radius:number;spawn:Point};
export type Settings={floorY:number;eyeHeight:number;speed:number;sprintMultiplier:number;radius:number;spawn:Point;yaw:number};
export const EMPTY:HotspotDocument={schemaVersion:1,spaceId:'classroom',coordinateSpace:'model-local',hotspots:[]};
export const DRAFT_KEY='jiedong-classroom-hotspots-v1';
export const SETTINGS_KEY='jiedong-classroom-settings-v1';
export function assetURL(path:string,baseURL:string=new URL(import.meta.env?.BASE_URL??'/',location.href).href):string{
 const clean=path.trim();let decoded:string;try{decoded=decodeURIComponent(clean)}catch{throw Error('媒体路径编码无效')}
 if(!clean||/^[a-z]:|^\/|\\|^(javascript|data|blob|file):/i.test(decoded)||decoded.split('/').includes('..'))throw Error('请填写 memories/ 下的资源路径或 HTTPS 地址');
 const url=new URL(clean,baseURL);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('媒体地址必须使用 HTTPS');
 if(url.username||url.password)throw Error('媒体地址不能包含密码');return url.href;
}
const text=(value:unknown,max:number)=>typeof value==='string'&&value.length<=max;
const dateOK=(value:unknown)=>{
 if(!text(value,32))return false;if(!value)return true;if(!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value as string))return false;
 const parts=(value as string).split('-').map(Number);if(parts[0]<1000)return false;if(parts.length===1)return true;if(parts[1]<1||parts[1]>12)return false;if(parts.length===2)return true;
 return parts[2]>=1&&parts[2]<=new Date(Date.UTC(parts[0],parts[1],0)).getUTCDate();
};
export function validateHotspots(value:unknown):HotspotDocument{
 const d=value as HotspotDocument;
 if(!d||d.schemaVersion!==1||d.spaceId!=='classroom'||d.coordinateSpace!=='model-local'||!Array.isArray(d.hotspots)||d.hotspots.length>1000)throw Error('不是有效的教室热点 JSON（schemaVersion: 1 / model-local）');
 const ids=new Set<string>();
 for(const h of d.hotspots){
  if(!h||!text(h.id,100)||!h.id||ids.has(h.id)||!text(h.title,100)||!h.title.trim()||!text(h.description,20000)||!dateOK(h.date)||!Array.isArray(h.position)||h.position.length!==3||h.position.some(n=>!Number.isFinite(n)||Math.abs(n)>10000)||!Array.isArray(h.tags)||h.tags.length>30||h.tags.some(t=>!text(t,60))||!Array.isArray(h.media)||h.media.length>100)throw Error('热点字段、坐标或 ID 无效，原草稿未被替换');
  ids.add(h.id);const mediaIds=new Set<string>();
  for(const m of h.media){if(!m||!text(m.id,100)||!m.id||mediaIds.has(m.id)||!['image','video','audio'].includes(m.type)||!text(m.src,2000)||!text(m.caption,1000)||!dateOK(m.date))throw Error('媒体字段无效');assetURL(m.src,'https://example.org/project/');mediaIds.add(m.id)}
 }
 return JSON.parse(JSON.stringify(d));
}
export function selectMedia(media:readonly Media[],year:string,sort:'asc'|'desc'):Media[]{
 return media.filter(m=>year==='all'||(year==='undated'?!m.date:m.date.startsWith(year))).sort((a,b)=>{if(!a.date)return b.date?1:0;if(!b.date)return -1;return a.date.localeCompare(b.date)*(sort==='asc'?1:-1)});
}
export function canStand(x:number,z:number,nav:Pick<Navigation,'x0'|'z0'|'width'|'height'|'resolution'|'cells'>):boolean{
 const ix=Math.floor((x-nav.x0)/nav.resolution),iz=Math.floor((z-nav.z0)/nav.resolution);
 return ix>=0&&iz>=0&&ix<nav.width&&iz<nav.height&&nav.cells[iz*nav.width+ix]===1;
}
export function localToWorld(point:Point,matrix:Matrix4):Point{return new Vector3(...point).applyMatrix4(matrix).toArray() as Point}
export function worldToLocal(point:Point,matrix:Matrix4):Point{return new Vector3(...point).applyMatrix4(matrix.clone().invert()).toArray() as Point}
export function newHotspot(position:Point):Hotspot{return {id:crypto.randomUUID(),title:'待补充回忆',description:'',date:'',position,tags:[],media:[]}}
export function resolvePublished(published:HotspotDocument,current:HotspotDocument,revisionAtRequest:number,revisionNow:number){return revisionAtRequest===revisionNow?published:current}
export function validateSettings(next:Settings,valid:(x:number,z:number,radius:number)=>boolean):Settings{
 if(!next||!['floorY','eyeHeight','speed','sprintMultiplier','radius','yaw'].every(key=>Number.isFinite(next[key as keyof Omit<Settings,'spawn'>]))||next.eyeHeight<.6||next.eyeHeight>2.2||next.speed<.2||next.speed>4||next.radius<.16||next.radius>.6||next.sprintMultiplier<1||next.sprintMultiplier>3||!Array.isArray(next.spawn)||next.spawn.length!==3||next.spawn.some(v=>!Number.isFinite(v))||!valid(next.spawn[0],next.spawn[2],next.radius))throw Error('出生点需要位于可走区域，高度、速度、半径和朝向需要有效');
 return {...next,spawn:[...next.spawn]};
}
export function downloadJSON(value:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

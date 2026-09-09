import * as T from 'three';
import defaultModelConfig from '../public/model-sources.json';
import {loadModelBlob,readModelConfig,type ModelProgress} from './model-download';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
export const memories=[{id:'bed',title:'床边',position:[.15,-.1,-.85]},{id:'cabinet',title:'柜子旁',position:[2.35,.25,1.15]},{id:'window',title:'窗边',position:[-3.3,.05,.1]}];
export function createScene(host:HTMLElement,events:any){
 const renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.outputColorSpace=T.SRGBColorSpace;renderer.localClippingEnabled=true;host.appendChild(renderer.domElement);const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','宿舍三维场景，WASD移动，方向键转向，拖动环顾');
 const scene=new T.Scene();scene.background=new T.Color('#b3bbba');const cam=new T.PerspectiveCamera(70,1,.045,60);cam.rotation.order='YXZ';const orbit=new OrbitControls(cam,canvas);orbit.enabled=false;orbit.enableDamping=true;orbit.minDistance=5;orbit.maxDistance=17;orbit.maxPolarAngle=Math.PI*.46;orbit.enablePan=false;
 const cut=new T.Plane(new T.Vector3(0,-1,0),.8);const fills=new T.Group();scene.add(fills);const materials:T.MeshBasicMaterial[]=[];
 function patch(w:number,h:number,pos:number[],rot:number[],color:string){const m=new T.MeshBasicMaterial({color,side:T.DoubleSide});const o=new T.Mesh(new T.PlaneGeometry(w,h),m);o.position.fromArray(pos);o.rotation.set(rot[0],rot[1],rot[2]);o.userData.base=color;materials.push(m);fills.add(o)}
 patch(7.45,3.9,[.175,-1.603,0],[-Math.PI/2,0,0],'#9b9b91');
 patch(7.45,3.9,[.175,1.565,0],[Math.PI/2,0,0],'#d1d0c3');
 patch(7.45,3.17,[.175,-.02,1.96],[0,0,0],'#cfcec0');patch(7.45,3.17,[.175,-.02,-1.97],[0,0,0],'#cfcec0');
 // Neutral backing behind scanned openings; no invented window view or door detail.
 patch(3.9,3.17,[-5.61,-.02,0],[0,Math.PI/2,0],'#bac4bb');patch(3.9,3.17,[5.55,-.02,0],[0,Math.PI/2,0],'#b9b6aa');
 const keyset=new Set<string>(),abort=new AbortController();let nav:any,model:T.Group|undefined,mode='walk',night=false,ready=false,disposed=false,frame=0,modelSeq=0,last=performance.now(),lastUI=0,paused=false,drag:any=null,moved=0;
 let joy={x:0,y:0};let lastWalk=new T.Vector3(2.35,.08,0);const ray=new T.Raycaster();const worldDirection=new T.Vector3();const hot=new Map<string,T.Vector3>(memories.map(m=>[m.id,new T.Vector3(...m.position as [number,number,number])]));
 function listen(target:any,name:string,fn:any,opts:any={}){target.addEventListener(name,fn,{...opts,signal:abort.signal})}
 function updateStyle(){scene.background=new T.Color(night?'#4a5665':'#b3bbba');if(model)model.traverse((o:any)=>{if(o.isMesh){o.material.color.set(night?'#bec8e0':'#ffffff');o.material.clippingPlanes=mode==='overview'?[cut]:[];o.material.needsUpdate=true}});fills.visible=true;fills.children.forEach((o:any,i:number)=>{o.visible=!(mode==='overview'&&i>=4);o.material.color.set(o.userData.base);if(night)o.material.color.multiply(new T.Color('#b8c4e0'));o.material.clippingPlanes=mode==='overview'?[cut]:[]});}
 function release(){keyset.clear();joy={x:0,y:0};drag=null;if(document.pointerLockElement===canvas)document.exitPointerLock()}
 function home(){release();mode='walk';orbit.enabled=false;cam.position.fromArray(nav?.spawn??[2.35,.08,0]);cam.rotation.set(-.045,Math.PI/2,0);lastWalk.copy(cam.position);updateStyle();events.mode?.('walk')}
 function overview(){release();if(mode==='walk')lastWalk.copy(cam.position);mode='overview';cam.position.set(0,9.3,.01);orbit.target.set(0,-.4,0);orbit.enabled=true;orbit.update();updateStyle();events.mode?.('overview')}
 function resume(){release();mode='walk';orbit.enabled=false;cam.position.copy(lastWalk);cam.rotation.set(-.045,Math.PI/2,0);updateStyle();events.mode?.('walk')}
 function valid(x:number,z:number){if(!nav)return false;const ix=Math.floor((x-nav.x0)/nav.resolution),iz=Math.floor((z-nav.z0)/nav.resolution);return ix>=0&&iz>=0&&ix<nav.width&&iz<nav.height&&nav.cells[iz*nav.width+ix]===1}
 function move(dx:number,dz:number){if(!ready||paused||mode!=='walk')return;const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.015));for(let i=0;i<steps;i++){if(valid(cam.position.x+dx/steps,cam.position.z))cam.position.x+=dx/steps;if(valid(cam.position.x,cam.position.z+dz/steps))cam.position.z+=dz/steps}cam.position.y=nav.floor+nav.eyeHeight;lastWalk.copy(cam.position)}
 function look(dx:number,dy:number){if(mode!=='walk'||paused)return;cam.rotation.y-=dx*.0028;cam.rotation.x=T.MathUtils.clamp(cam.rotation.x-dy*.0028,-1.35,1.35);cam.rotation.z=0}
 async function loadModel(){const seq=++modelSeq;events.status('正在载入真实宿舍…');events.loading(true);try{const baseURL=new URL(import.meta.env.BASE_URL,location.href).href;
 const config=await readModelConfig(defaultModelConfig,baseURL,abort.signal);
 let lastProgress:ModelProgress|undefined;
 const result=await loadModelBlob(config,{baseURL,signal:abort.signal,onProgress:p=>{lastProgress=p;events.progress?.(p);events.status(p.message)}});
 if(disposed)return;
 events.status(result.fromCache?'正在从本地缓存还原宿舍…':'正在解析宿舍模型…');
 events.progress?.({...lastProgress,phase:'parsing',message:result.fromCache?'正在从本地缓存还原宿舍…':'正在解析宿舍模型…'});
 const objectURL=URL.createObjectURL(result.blob);
 let g;
 try{g=await new GLTFLoader().loadAsync(objectURL)}catch(error){throw new Error('模型下载及校验已成功，但解析或内嵌贴图解码失败')}finally{URL.revokeObjectURL(objectURL)};
if(disposed||seq!==modelSeq){g.scene.traverse((o:any)=>{if(o.isMesh){o.geometry.dispose();o.material.map?.dispose();o.material.dispose()}});return}const old=model;model=g.scene;model.traverse((o:any)=>{if(o.isMesh){o.material.side=T.DoubleSide;if(o.material.map)o.material.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy())}});scene.add(model);if(old){scene.remove(old);old.traverse((o:any)=>{if(o.isMesh){o.geometry.dispose();o.material.map?.dispose();o.material.dispose()}})}if(!ready)home();ready=!!nav;updateStyle();events.status('扫描漫游 · 揭东一中 2024 届');events.progress?.({...lastProgress,phase:'ready'});events.loading(false);events.ready?.(true)}catch(e){if(disposed||abort.signal.aborted)return;events.status(e instanceof Error?e.message:'模型加载失败，请重试');events.loading(false);events.error?.(String(e))}}
 fetch(import.meta.env.BASE_URL+'assets/navigation.json',{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('navigation');return r.json()}).then(n=>{if(disposed)return;nav=n;home();loadModel()}).catch(()=>{if(disposed)return;events.status('漫游数据读取失败，请刷新重试');events.loading(false)});
 home();
 listen(canvas,'pointerdown',(e:PointerEvent)=>{if(paused||!ready)return;canvas.focus({preventScroll:true});drag={id:e.pointerId,x:e.clientX,y:e.clientY};moved=0;canvas.setPointerCapture(e.pointerId)});
 listen(canvas,'pointermove',(e:PointerEvent)=>{if(e.pointerType==='mouse'&&e.buttons===0&&document.pointerLockElement!==canvas){drag=null;return}if(document.pointerLockElement===canvas){look(e.movementX,e.movementY);return}if(drag?.id===e.pointerId){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;look(dx,dy);moved+=Math.abs(dx)+Math.abs(dy);drag.x=e.clientX;drag.y=e.clientY}});
 listen(window,'pointerup',()=>drag=null);listen(canvas,'lostpointercapture',()=>drag=null);listen(canvas,'pointerup',()=>drag=null);listen(canvas,'pointercancel',()=>drag=null);
 listen(window,'keydown',(e:KeyboardEvent)=>{if(paused||(e.target as HTMLElement)?.closest('input,textarea,[role=dialog]'))return;if(['KeyW','KeyA','KeyS','KeyD','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)){e.preventDefault();keyset.add(e.code)}if(e.code==='KeyE')events.interact?.()});listen(window,'keyup',(e:KeyboardEvent)=>keyset.delete(e.code));listen(window,'blur',release);listen(document,'visibilitychange',()=>{if(document.hidden)release()});
 listen(document,'pointerlockchange',()=>{events.lock?.(document.pointerLockElement===canvas);if(document.pointerLockElement!==canvas)keyset.clear()});
 function lock(){if(mode!=='walk')resume();if(document.pointerLockElement===canvas){document.exitPointerLock();return}canvas.requestPointerLock()?.catch(()=>events.status('可按住鼠标拖动环顾'))}
 function projectUI(now:number){if(now-lastUI<100)return;lastUI=now;cam.getWorldDirection(worldDirection);const marks=memories.map(m=>{const p=hot.get(m.id)!;const q=p.clone().project(cam);const delta=p.clone().sub(cam.position);let visible=ready&&q.z<1&&q.z>-1&&q.x>-1&&q.x<1&&q.y>-1&&q.y<1; // Stop markers showing through scan surfaces.
 if(visible&&model&&mode==='walk'){ray.set(cam.position,delta.clone().normalize());ray.far=delta.length()-.18;const hits=ray.intersectObject(model,true);if(hits.length)visible=false}
 return {id:m.id,x:(q.x+1)*50,y:(1-q.y)*50,visible}});events.frame?.({x:cam.position.x,z:cam.position.z,y:cam.position.y,yaw:cam.rotation.y,mode,marks});}
 function tick(now:number){frame=requestAnimationFrame(tick);const dt=Math.min((now-last)/1000,.04);last=now;if(mode==='walk'&&!paused){if(keyset.has('ArrowLeft'))cam.rotation.y+=dt*1.1;if(keyset.has('ArrowRight'))cam.rotation.y-=dt*1.1;if(keyset.has('ArrowUp'))cam.rotation.x=Math.min(1.35,cam.rotation.x+dt*.8);if(keyset.has('ArrowDown'))cam.rotation.x=Math.max(-1.35,cam.rotation.x-dt*.8);let f=(keyset.has('KeyW')?1:0)-(keyset.has('KeyS')?1:0)-joy.y;let s=(keyset.has('KeyD')?1:0)-(keyset.has('KeyA')?1:0)+joy.x;const len=Math.max(1,Math.hypot(f,s));f/=len;s/=len;const speed=1.15*dt;move((-Math.sin(cam.rotation.y)*f+Math.cos(cam.rotation.y)*s)*speed,(-Math.cos(cam.rotation.y)*f-Math.sin(cam.rotation.y)*s)*speed)}if(mode==='overview')orbit.update();renderer.render(scene,cam);projectUI(now)}
 function resize(){renderer.setSize(host.clientWidth,host.clientHeight);cam.aspect=host.clientWidth/host.clientHeight;cam.updateProjectionMatrix()}listen(window,'resize',resize);listen(canvas,'webglcontextlost',(e:Event)=>{e.preventDefault();ready=false;events.status('图形上下文中断，请刷新恢复');events.ready?.(false)});resize();frame=requestAnimationFrame(tick);
 return {home,overview,resume,lock,valid,move,setJoy(x:number,y:number){joy={x,y}},pause(v:boolean){paused=v;if(v)release()},setNight(v:boolean){night=v;updateStyle()},getState(){return {ready,mode,night,position:cam.position.toArray(),triangles:renderer.info.render.triangles,texture:4096}},dispose(){disposed=true;modelSeq++;abort.abort();release();cancelAnimationFrame(frame);orbit.dispose();scene.traverse((o:any)=>{if(o.isMesh){o.geometry.dispose();o.material.map?.dispose();o.material.dispose()}});renderer.dispose();canvas.remove()}};
}

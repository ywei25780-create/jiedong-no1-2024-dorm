import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {loadModelBlob,validateConfig,type ModelProgress} from '../model-download';
import bundledModel from '../../public/data/classroom-model.json';
import bundledScene from '../../public/data/classroom-scene.json';
import {assetURL,canStand,worldToLocal,localToWorld,validateSettings,type Hotspot,type Navigation,type Point,type Settings} from './data';
import {disposeObject} from './resources';

export type {Settings} from './data';
export type Mark={id:string;x:number;y:number;distance:number};
export type View={position:Point;yaw:number;marks:Mark[];mode:string;triangles:number;hiddenMarks:number};
type Events={status:(message:string)=>void;progress:(p:ModelProgress)=>void;ready:(placeholder:boolean)=>void;frame:(v:View)=>void;pick:(p:Point)=>void;lock:(locked:boolean)=>void;error:(message:string)=>void};
export type ClassroomAPI=ReturnType<typeof createClassroomScene>;

export function createClassroomScene(host:HTMLElement,events:Events){
 const controller=new AbortController(),canvasAbort=controller.signal;
 const renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,matchMedia('(pointer:coarse)').matches?1.25:1.75));renderer.outputColorSpace=T.SRGBColorSpace;renderer.localClippingEnabled=true;
 host.append(renderer.domElement);const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','教室三维场景；WASD 移动，拖动环顾；编辑模式下点击表面创建热点');
 const scene=new T.Scene();scene.background=new T.Color('#9dacae');scene.add(new T.HemisphereLight('#fff6e4','#737c83',2));
 const camera=new T.PerspectiveCamera(67,1,.04,150);camera.rotation.order='YXZ';
 const orbit=new OrbitControls(camera,canvas);orbit.enabled=false;orbit.enableDamping=true;orbit.minDistance=.3;orbit.maxDistance=35;orbit.enablePan=true;
 const root=new T.Group();scene.add(root);let model:T.Object3D|undefined;let nav:Navigation|undefined;let bounds=new T.Box3();
 let settings:Settings={...bundledScene,spawn:bundledScene.spawn as Point};let mode='walk',ready=false,disposed=false,paused=false,editing=false,night=false;
 let hotspots:Hotspot[]=[],keys=new Set<string>(),joy={x:0,y:0},drag:{x:number;y:number;startX:number;startY:number;id:number}|null=null,moved=0;
 let lastWalk=new T.Vector3(),lastAngles=new T.Euler(0,.72,0,'YXZ'),raf=0,last=performance.now(),lastUI=0;
 const ray=new T.Raycaster(),mouse=new T.Vector2();const floor=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({color:'#92978b',side:T.DoubleSide}));floor.rotation.x=-Math.PI/2;scene.add(floor);floor.visible=false;
 const cut=new T.Plane(new T.Vector3(0,-1,0),.6);
 function listen(target:EventTarget,name:string,fn:EventListener){target.addEventListener(name,fn,{signal:canvasAbort})}
 function release(){keys.clear();joy={x:0,y:0};drag=null;if(document.pointerLockElement===canvas)document.exitPointerLock()}
 function style(){scene.background=new T.Color(night?'#586877':'#9dacae');root.traverse((o)=>{if(o instanceof T.Mesh){const mats=Array.isArray(o.material)?o.material:[o.material];for(const material of mats){if('color'in material)(material as T.MeshBasicMaterial).color.set(night?'#c9d1df':'#ffffff');material.clippingPlanes=mode==='overview'?[cut]:[];material.needsUpdate=true}}});floor.material.color.set(night?'#6e7983':'#92978b')}
 function home(){release();mode='walk';orbit.enabled=false;camera.position.fromArray(settings.spawn);camera.position.y=settings.floorY+settings.eyeHeight;camera.rotation.set(-.03,settings.yaw,0);lastWalk.copy(camera.position);lastAngles.copy(camera.rotation);style();lastUI=0}
 function setMode(next:string){release();if(mode==='walk'){lastWalk.copy(camera.position);lastAngles.copy(camera.rotation)}mode=next;
  if(next==='walk'){orbit.enabled=false;camera.position.copy(lastWalk);camera.position.y=settings.floorY+settings.eyeHeight;camera.rotation.copy(lastAngles)}
  else{orbit.enabled=true;orbit.target.copy(bounds.getCenter(new T.Vector3()));if(next==='overview'){camera.position.copy(orbit.target).add(new T.Vector3(.01,14,.01));orbit.maxPolarAngle=Math.PI*.45}else{orbit.maxPolarAngle=Math.PI;orbit.target.copy(camera.position).add(camera.getWorldDirection(new T.Vector3()).multiplyScalar(3))}orbit.update()}
  style();lastUI=0;
 }
 function valid(x:number,z:number,radius=settings.radius){if(!nav)return false;const p=worldToLocal([x,settings.floorY,z],root.matrixWorld);if(!canStand(p[0],p[2],nav))return false;
  const margin=Math.max(0,radius/root.scale.x-nav.radius);if(margin)for(let i=0;i<8;i++){const a=i*Math.PI/4;if(!canStand(p[0]+Math.cos(a)*margin,p[2]+Math.sin(a)*margin,nav))return false}return true;
 }
 function move(dx:number,dz:number){if(!ready||paused||mode!=='walk')return;const n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.025));for(let i=0;i<n;i++){if(valid(camera.position.x+dx/n,camera.position.z))camera.position.x+=dx/n;if(valid(camera.position.x,camera.position.z+dz/n))camera.position.z+=dz/n}camera.position.y=settings.floorY+settings.eyeHeight}
 function look(dx:number,dy:number){if(mode!=='walk'||paused)return;camera.rotation.y-=dx*.0026;camera.rotation.x=T.MathUtils.clamp(camera.rotation.x-dy*.0026,-1.48,1.48)}
 function pick(clientX:number,clientY:number){if(!model)return;const r=canvas.getBoundingClientRect();mouse.set((clientX-r.left)/r.width*2-1,-(clientY-r.top)/r.height*2+1);ray.setFromCamera(mouse,camera);ray.far=100;const hit=ray.intersectObject(model,true)[0];if(hit)events.pick(worldToLocal(hit.point.toArray() as Point,root.matrixWorld));else events.status('这里没有扫描表面，请点击课桌、墙面或地板')}
 listen(canvas,'pointerdown',((event:PointerEvent)=>{if(!ready||paused)return;canvas.focus({preventScroll:true});drag={x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,id:event.pointerId};moved=0;if(mode==='walk')canvas.setPointerCapture(event.pointerId)}) as EventListener);
 listen(canvas,'pointermove',((event:PointerEvent)=>{if(document.pointerLockElement===canvas){look(event.movementX,event.movementY);return}if(drag?.id===event.pointerId){const dx=event.clientX-drag.x,dy=event.clientY-drag.y;moved+=Math.abs(dx)+Math.abs(dy);look(dx,dy);drag.x=event.clientX;drag.y=event.clientY}}) as EventListener);
 listen(canvas,'pointerup',((event:PointerEvent)=>{if(editing&&!paused&&moved<7&&drag?.id===event.pointerId)pick(event.clientX,event.clientY);drag=null}) as EventListener);
 listen(window,'pointerup',(()=>drag=null) as EventListener);listen(canvas,'pointercancel',(()=>drag=null) as EventListener);
 listen(window,'keydown',((event:KeyboardEvent)=>{if(paused||(event.target as HTMLElement)?.closest('input,textarea,select,[role=dialog]'))return;if(['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.code)){event.preventDefault();keys.add(event.code)}}) as EventListener);
 listen(window,'keyup',((event:KeyboardEvent)=>{keys.delete(event.code)}) as EventListener);listen(window,'blur',release as EventListener);
 listen(document,'visibilitychange',(()=>{if(document.hidden)release()}) as EventListener);
 listen(document,'pointerlockchange',(()=>{events.lock(document.pointerLockElement===canvas);if(document.pointerLockElement!==canvas)keys.clear()}) as EventListener);
 function lock(){if(editing||paused)return;if(document.pointerLockElement===canvas){document.exitPointerLock();return}canvas.requestPointerLock()?.catch(()=>events.status('浏览器没有允许鼠标锁定，可以按住鼠标拖动环顾'))}
 function marks(){const candidates:Mark[]=[];for(const h of hotspots){const point=new T.Vector3(...localToWorld(h.position,root.matrixWorld));const distance=point.distanceTo(camera.position);const q=point.clone().project(camera);if(q.z<=-1||q.z>=1||Math.abs(q.x)>.98||Math.abs(q.y)>.94)continue;
   if(mode==='walk'&&model){ray.set(camera.position,point.clone().sub(camera.position).normalize());ray.far=Math.max(0,distance-.12);if(ray.intersectObject(model,true).length)continue}
   candidates.push({id:h.id,x:(q.x+1)*50,y:(1-q.y)*50,distance});
  }candidates.sort((a,b)=>a.distance-b.distance);const visible:Mark[]=[];for(const m of candidates){if(visible.length<40&&!visible.some(v=>Math.hypot((v.x-m.x)*host.clientWidth/100,(v.y-m.y)*host.clientHeight/100)<42))visible.push(m)}return {marks:visible,hiddenMarks:candidates.length-visible.length};
 }
 function tick(now:number){raf=requestAnimationFrame(tick);const dt=Math.min((now-last)/1000,.04);last=now;
  if(!document.hidden){if(mode==='walk'&&!paused){if(keys.has('ArrowLeft'))camera.rotation.y+=dt;if(keys.has('ArrowRight'))camera.rotation.y-=dt;if(keys.has('ArrowUp'))camera.rotation.x=T.MathUtils.clamp(camera.rotation.x+dt,-1.48,1.48);if(keys.has('ArrowDown'))camera.rotation.x=T.MathUtils.clamp(camera.rotation.x-dt,-1.48,1.48);
    let f=Number(keys.has('KeyW'))-Number(keys.has('KeyS'))-joy.y,s=Number(keys.has('KeyD'))-Number(keys.has('KeyA'))+joy.x;const len=Math.max(1,Math.hypot(f,s));f/=len;s/=len;const speed=settings.speed*dt*((keys.has('ShiftLeft')||keys.has('ShiftRight'))?settings.sprintMultiplier:1);move((-Math.sin(camera.rotation.y)*f+Math.cos(camera.rotation.y)*s)*speed,(-Math.cos(camera.rotation.y)*f-Math.sin(camera.rotation.y)*s)*speed)}
   if(orbit.enabled&&!paused)orbit.update();renderer.render(scene,camera);
   if(now-lastUI>250){lastUI=now;events.frame({position:camera.position.toArray() as Point,yaw:camera.rotation.y,mode,triangles:renderer.info.render.triangles,...marks()})}
  }
 }
 function resize(){renderer.setSize(host.clientWidth,host.clientHeight);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix()}
 listen(window,'resize',resize);listen(canvas,'webglcontextlost',((event:Event)=>{event.preventDefault();release();events.error('图形上下文中断，请刷新页面')}) as EventListener);
 async function json(path:string){const response=await fetch(assetURL(path),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(6000)]),cache:'no-store'});if(!response.ok)throw Error(`资源读取失败：${path}`);return response.json()}
 function placeholder(reason:string){if(disposed)return;const fallback=new T.Group();const grid=new T.GridHelper(8,16,'#bcb8a8','#687979');fallback.add(grid);model=fallback;root.add(fallback);bounds.setFromObject(root);settings.floorY=0;settings.spawn=[0,1.65,3];settings.yaw=0;nav={x0:-4,z0:-4,width:80,height:80,resolution:.1,cells:Array(6400).fill(1),floorY:0,radius:.16,spawn:settings.spawn};ready=true;home();events.status('占位场景：真实扫描未载入');events.error(reason);events.ready(true)}
 async function load(){try{
   const config=await json('data/classroom-scene.json').catch(()=>bundledScene);const modelConfig=await json('data/classroom-model.json').catch(()=>bundledModel);
   settings={floorY:config.floorY,eyeHeight:config.eyeHeight,speed:config.speed,sprintMultiplier:config.sprintMultiplier,radius:config.radius,spawn:config.spawn,yaw:config.yaw};
   nav=await json(config.navigation);const t=config.transform;root.position.fromArray(t.position);root.rotation.set(...(t.rotationDegrees.map((v:number)=>T.MathUtils.degToRad(v)) as Point));root.scale.setScalar(t.scale);root.updateMatrixWorld(true);
   const result=await loadModelBlob(validateConfig(modelConfig),{baseURL:new URL(import.meta.env.BASE_URL,location.href).href,signal:controller.signal,onProgress:p=>{events.progress(p);events.status(p.message)}});
   if(disposed)return;events.status('正在解析真实教室与贴图…');const url=URL.createObjectURL(result.blob);try{const gltf=await new GLTFLoader().loadAsync(url);if(disposed){disposeObject(gltf.scene);return}model=gltf.scene;root.add(model)}finally{URL.revokeObjectURL(url)}
   bounds.setFromObject(root);const size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());floor.scale.set(size.x,size.z,1);floor.position.set(center.x,settings.floorY-.035,center.z);floor.visible=true;cut.constant=settings.floorY+2.25;
   ready=true;home();events.status('真实高二教室 · 扫描纹理');events.ready(false);
  }catch(error){if(!disposed&&!controller.signal.aborted)placeholder(error instanceof Error?error.message:'模型加载失败')}
 }
 resize();home();raf=requestAnimationFrame(tick);void load();
 return {home,setMode,lock,valid,move,setJoy(x:number,y:number){joy={x,y}},setHotspots(value:Hotspot[]){hotspots=value;lastUI=0},setEditing(value:boolean){editing=value;release()},pause(value:boolean){paused=value;orbit.enabled=mode!=='walk'&&!value;if(value)release()},setNight(value:boolean){night=value;style()},getSettings(){return {...settings,spawn:[...settings.spawn] as Point}},getPosition(){return camera.position.toArray() as Point},configure(next:Settings){
   settings=validateSettings(next,valid);floor.position.y=settings.floorY-.035;home();return settings;
  },dispose(){disposed=true;controller.abort();release();cancelAnimationFrame(raf);orbit.dispose();disposeObject(scene);renderer.dispose();canvas.remove()}};
}

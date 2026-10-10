import {Mesh,Raycaster,Vector2,type Material,type Object3D,type PerspectiveCamera} from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';

type Tap={x:number;y:number;time:number};
type Press=Tap&{id:number;dragged:boolean};
export function bindSurfaceFocus(canvas:HTMLElement,options:{enabled:()=>boolean;focus:(clientX:number,clientY:number)=>void},signal:AbortSignal):()=>void{
 const touches=new Set<number>();let press:Press|null=null,lastTap:Tap|null=null,multi=false,lastTouch=-Infinity;
 let mouseTaps:{time:number;valid:boolean}[]=[];
 function reset(){touches.clear();press=null;lastTap=null;multi=false;mouseTaps=[]}
 function listen(target:EventTarget,name:string,callback:(event:any)=>void){target.addEventListener(name,callback,{signal})}
 function distance(event:{clientX:number;clientY:number},point:Tap){return Math.hypot(event.clientX-point.x,event.clientY-point.y)}
 listen(canvas,'pointerdown',(event:PointerEvent)=>{
  if(!options.enabled()){reset();return}
  if(event.pointerType==='touch'){
   touches.add(event.pointerId);
   if(touches.size>1||multi){multi=true;press=null;lastTap=null;return}
  }else if(event.button!==0)return;
  press={id:event.pointerId,x:event.clientX,y:event.clientY,time:event.timeStamp,dragged:false};
 });
 listen(canvas,'pointermove',(event:PointerEvent)=>{
  if(press?.id===event.pointerId&&distance(event,press)>8){press.dragged=true;lastTap=null}
 });
 listen(canvas,'pointerup',(event:PointerEvent)=>{
  const touch=event.pointerType==='touch';if(touch){lastTouch=event.timeStamp;touches.delete(event.pointerId)}
  if(!options.enabled()){reset();return}
  const valid=press?.id===event.pointerId&&!press.dragged&&distance(event,press)<=8;
  if(press?.id===event.pointerId)press=null;
  if(!touch){mouseTaps.push({time:event.timeStamp,valid});mouseTaps=mouseTaps.slice(-2);return}
  const single=!multi&&touches.size===0;if(touches.size===0)multi=false;
  if(!valid||!single){lastTap=null;return}
  if(lastTap&&event.timeStamp-lastTap.time>=0&&event.timeStamp-lastTap.time<=350&&distance(event,lastTap)<=24){
   lastTap=null;options.focus(event.clientX,event.clientY);
  }else lastTap={x:event.clientX,y:event.clientY,time:event.timeStamp};
 });
 listen(canvas,'dblclick',(event:MouseEvent)=>{
  if(event.button!==0||!options.enabled()||event.timeStamp-lastTouch<=700)return;
  if(mouseTaps.some(tap=>!tap.valid&&event.timeStamp-tap.time<=700))return;
  options.focus(event.clientX,event.clientY);
 });
 listen(canvas,'pointercancel',reset);
 listen(canvas,'lostpointercapture',(event:PointerEvent)=>{if(press?.id===event.pointerId)reset()});
 const document=canvas.ownerDocument;
 if(document.defaultView)listen(document.defaultView,'blur',reset);
 listen(document,'visibilitychange',reset);signal.addEventListener('abort',reset,{once:true});
 return reset;
}

export function focusAtSurface(camera:PerspectiveCamera,orbit:OrbitControls,model:Object3D,rect:{left:number;top:number;width:number;height:number},x:number,y:number,locked=false):boolean{
 if(rect.width<=0||rect.height<=0)return false;
 camera.updateWorldMatrix(true,false);model.updateWorldMatrix(true,true);
 const ray=new Raycaster();ray.near=camera.near;ray.far=camera.far;
 ray.setFromCamera(locked?new Vector2():new Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1),camera);
 const hit=ray.intersectObject(model,true).find(value=>{
  if(!(value.object instanceof Mesh))return false;
  for(let ancestor:Object3D|null=value.object;ancestor;ancestor=ancestor.parent)if(!ancestor.visible)return false;
  const material:Material|undefined=Array.isArray(value.object.material)?value.object.material[value.face?.materialIndex??0]:value.object.material;
  if(!material?.visible)return false;
  const planes=material.clippingPlanes;
  return !planes?.length||!(material.clipIntersection?planes.every(plane=>plane.distanceToPoint(value.point)<0):planes.some(plane=>plane.distanceToPoint(value.point)<0));
 });
 if(!hit)return false;
 const position=camera.position.clone();
 const settings={enableDamping:orbit.enableDamping,autoRotate:orbit.autoRotate,minDistance:orbit.minDistance,maxDistance:orbit.maxDistance,minPolarAngle:orbit.minPolarAngle,maxPolarAngle:orbit.maxPolarAngle};
 try{
  // A non-damped update flushes pending rotation/pan through the public API.
  Object.assign(orbit,{enableDamping:false,autoRotate:false,minDistance:0,maxDistance:Infinity,minPolarAngle:0,maxPolarAngle:Math.PI});
  orbit.update();orbit.target.copy(hit.point);camera.position.copy(position);orbit.update();
  camera.position.copy(position);camera.lookAt(hit.point);camera.updateMatrixWorld();
 }finally{Object.assign(orbit,settings)}
 return true;
}

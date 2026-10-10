import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,DoubleSide,Group,Mesh,MeshBasicMaterial,PerspectiveCamera,Plane,PlaneGeometry,Vector3} from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {bindSurfaceFocus,focusAtSurface} from '../app/observe.ts';

function gestures(onFocus?:()=>void){
 const window=new EventTarget(),document=Object.assign(new EventTarget(),{defaultView:window,hidden:false});
 const canvas=Object.assign(new EventTarget(),{ownerDocument:document}) as unknown as HTMLElement;
 const controller=new AbortController(),focused:number[][]=[];let enabled=true;
 const reset=bindSurfaceFocus(canvas,{enabled:()=>enabled,focus:(x,y)=>{focused.push([x,y]);onFocus?.()}},controller.signal);
 function emit(type:string,time:number,props:Record<string,unknown>={}){
  const event=Object.assign(new Event(type),{pointerType:'touch',pointerId:1,clientX:100,clientY:100,button:0,...props});
  Object.defineProperty(event,'timeStamp',{value:time});canvas.dispatchEvent(event);
 }
 function tap(time:number,props:Record<string,unknown>={}){emit('pointerdown',time,props);emit('pointerup',time+20,props)}
 return {window,document,canvas,controller,focused,reset,emit,tap,setEnabled(value:boolean){enabled=value}};
}
const rect={left:10,top:20,width:200,height:100};
function geometry(cameraPosition=new Vector3(0,0,5)){
 const camera=new PerspectiveCamera(60,2,.01,100);camera.position.copy(cameraPosition);
 const orbit=new OrbitControls(camera);camera.position.copy(cameraPosition);camera.lookAt(0,0,0);
 return {camera,orbit};
}
function close(a:Vector3,b:Vector3){assert(a.distanceTo(b)<1e-8,`${a.toArray()} != ${b.toArray()}`)}

test('mouse double click only focuses the enabled surface with the primary button; abort removes listeners',()=>{
 const g=gestures();g.emit('dblclick',100,{button:0,clientX:80,clientY:60});
 g.emit('dblclick',200,{button:1});g.setEnabled(false);g.emit('dblclick',300);
 assert.deepEqual(g.focused,[[80,60]]);
 g.controller.abort();g.setEnabled(true);g.emit('dblclick',1000);assert.equal(g.focused.length,1);
});

test('two nearby single touch taps focus once, including different pointer IDs and synthetic double click',()=>{
 const g=gestures();g.tap(0,{pointerId:4});g.tap(350,{pointerId:8,clientX:124});
 assert.deepEqual(g.focused,[[124,100]]);
 g.emit('dblclick',400);assert.equal(g.focused.length,1);
 g.emit('dblclick',1071,{clientX:60,clientY:70});assert.deepEqual(g.focused,[[124,100],[60,70]]);
 g.controller.abort();g.tap(2000);g.tap(2100);assert.equal(g.focused.length,2);
});

test('synchronous mode reset inside touch focus retains the synthetic double click guard',()=>{
 let reset=()=>{};const g=gestures(()=>reset());reset=g.reset;
 g.tap(0);g.tap(100);g.emit('dblclick',150);assert.equal(g.focused.length,1);
 g.emit('dblclick',821);assert.equal(g.focused.length,2);g.controller.abort();
});

test('touch drag out and back, multiple fingers, and cancellation never become double taps',()=>{
 const g=gestures();
 g.emit('pointerdown',0);g.emit('pointermove',10,{clientX:109});g.emit('pointermove',15);g.emit('pointerup',20);g.tap(100);
 assert.equal(g.focused.length,0);
 g.reset();g.emit('pointerdown',300);g.emit('pointerdown',310,{pointerId:2});
 g.emit('pointerup',320,{pointerId:2});g.emit('pointerup',330);g.tap(400);assert.equal(g.focused.length,0);
 g.reset();g.tap(600);g.emit('pointerdown',650);g.emit('pointercancel',660);g.tap(700);assert.equal(g.focused.length,0);
 g.controller.abort();
});

test('touch pairing rejects distant or late taps and resets across pause, reset, blur, and visibility changes',()=>{
 const g=gestures();g.tap(0);g.tap(400);assert.equal(g.focused.length,0);
 g.tap(500,{clientX:125});assert.equal(g.focused.length,0);
 for(const clear of [g.reset,()=>g.window.dispatchEvent(new Event('blur')),()=>g.document.dispatchEvent(new Event('visibilitychange'))]){
  g.reset();g.tap(1000);clear();g.tap(1100);assert.equal(g.focused.length,0);
 }
 g.reset();g.tap(2000);g.setEnabled(false);g.tap(2050);g.setEnabled(true);g.tap(2100);assert.equal(g.focused.length,0);
 g.controller.abort();
});

test('a mouse drag cannot focus from its subsequent native double click',()=>{
 const g=gestures(),mouse={pointerType:'mouse'};
 g.emit('pointerdown',0,mouse);g.emit('pointermove',5,{...mouse,clientX:109});g.emit('pointermove',10,mouse);g.emit('pointerup',20,mouse);
 g.tap(100,mouse);g.emit('dblclick',125);assert.equal(g.focused.length,0);
 g.tap(200,mouse);g.emit('dblclick',225);assert.equal(g.focused.length,1);
 g.controller.abort();
});

test('a transformed scan selects its world surface point without moving the camera or changing controller flags',()=>{
 const {camera,orbit}=geometry(new Vector3(2,1,5));
 const model=new Group();model.position.set(2,1,-3);model.rotation.z=Math.PI/3;model.scale.setScalar(2);
 model.add(new Mesh(new PlaneGeometry(2,2),new MeshBasicMaterial({side:DoubleSide})));
 camera.lookAt(2,1,-3);const before=camera.position.clone();
 orbit.minDistance=50;orbit.maxDistance=60;orbit.minPolarAngle=.05;orbit.maxPolarAngle=.1;orbit.enabled=false;orbit.enableDamping=true;
 assert(focusAtSurface(camera,orbit,model,rect,110,70));
 close(orbit.target,new Vector3(2,1,-3));close(camera.position,before);
 close(camera.getWorldDirection(new Vector3()),orbit.target.clone().sub(before).normalize());
 assert.equal(orbit.enabled,false);assert.equal(orbit.enableDamping,true);assert.equal(orbit.minDistance,50);assert.equal(orbit.maxDistance,60);assert.equal(orbit.maxPolarAngle,.1);
});

test('empty surface misses leave camera and target unchanged; pointer lock uses the centre ray',()=>{
 const {camera,orbit}=geometry();orbit.target.set(1,2,3);const position=camera.position.clone(),rotation=camera.quaternion.clone(),target=orbit.target.clone();
 assert.equal(focusAtSurface(camera,orbit,new Group(),rect,110,70),false);
 close(camera.position,position);close(orbit.target,target);assert(camera.quaternion.equals(rotation));
 const model=new Mesh(new PlaneGeometry(1,1),new MeshBasicMaterial({side:DoubleSide}));
 assert.equal(focusAtSurface(camera,orbit,model,rect,11,21),false);
 assert(focusAtSurface(camera,orbit,model,rect,11,21,true));close(orbit.target,new Vector3());close(camera.position,position);
});

test('ray focus skips hidden ancestors and clipped roof faces, using the intersected material index',()=>{
 const {camera,orbit}=geometry(new Vector3(0,5,2));camera.lookAt(0,0,0);
 const model=new Group(),hidden=new Group();hidden.visible=false;
 const roof=new Mesh(new PlaneGeometry(3,3),new MeshBasicMaterial({side:DoubleSide}));roof.rotation.x=-Math.PI/2;roof.position.y=3;hidden.add(roof);model.add(hidden);
 const materials=Array.from({length:6},()=>new MeshBasicMaterial({side:DoubleSide}));materials[2].clippingPlanes=[new Plane(new Vector3(0,-1,0),0)];
 model.add(new Mesh(new BoxGeometry(2,2,2),materials));
 assert(focusAtSurface(camera,orbit,model,rect,110,70));close(orbit.target,new Vector3(0,-1,-.4));
});

test('material clipIntersection only removes a point when every clipping plane removes it',()=>{
 const {camera,orbit}=geometry(),model=new Group();
 const material=new MeshBasicMaterial({side:DoubleSide,clippingPlanes:[new Plane(new Vector3(1,0,0),-1),new Plane(new Vector3(0,1,0),1)],clipIntersection:true});
 model.add(new Mesh(new PlaneGeometry(3,3),material));
 const behind=new Mesh(new PlaneGeometry(3,3),new MeshBasicMaterial({side:DoubleSide}));behind.position.z=-2;model.add(behind);
 assert(focusAtSurface(camera,orbit,model,rect,110,70));close(orbit.target,new Vector3());
 material.clipIntersection=false;assert(focusAtSurface(camera,orbit,model,rect,110,70));close(orbit.target,new Vector3(0,0,-2));
});

test('focusing clears old damping so following orbit updates do not drift from the new centre',()=>{
 const {camera,orbit}=geometry();orbit.enableDamping=true;orbit.autoRotate=true;orbit.update(1);orbit.autoRotate=false;
 const position=camera.position.clone(),model=new Mesh(new PlaneGeometry(10,10),new MeshBasicMaterial({side:DoubleSide}));
 assert(focusAtSurface(camera,orbit,model,rect,110,70));close(camera.position,position);const target=orbit.target.clone();
 for(let i=0;i<5;i++)orbit.update();close(camera.position,position);close(orbit.target,target);assert.equal(orbit.enableDamping,true);
});

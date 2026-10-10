import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Box3,PerspectiveCamera,Vector3} from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {clearOrbitMotion,fitOverviewCamera as fit} from '../app/classroom/view.ts';

// Exercise the published scan's real bounds, rather than a hand-picked cube.
const glb=readFileSync(new URL('../public/models/classroom.glb',import.meta.url));
const metadata=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString('utf8'));
const positions=metadata.accessors[metadata.meshes[0].primitives[0].attributes.POSITION];
const bounds=new Box3(new Vector3(...positions.min),new Vector3(...positions.max));
function corners(box:Box3){
 const result:Vector3[]=[];
 for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])result.push(new Vector3(x,y,z));
 return result;
}

for(const [name,aspect] of [['desktop',1280/720],['portrait phone',390/844],['narrow viewport',280/1000]] as const){
 test(`overview contains the entire actual scan on ${name}`,()=>{
  const camera=new PerspectiveCamera(67,aspect,.04,150);
  const framed=fit(camera,bounds);
  const orbit=new OrbitControls(camera);
  orbit.target.copy(framed.target);orbit.minDistance=.1;orbit.maxDistance=framed.maxDistance;orbit.maxPolarAngle=Math.PI*.45;
  orbit.update();camera.updateMatrixWorld();
  assert(framed.target.distanceTo(bounds.getCenter(new Vector3()))<1e-9);
  for(const corner of corners(bounds)){
   const projected=corner.project(camera);
   assert(Math.abs(projected.x)<1,`x=${projected.x} leaves the viewport`);
   assert(Math.abs(projected.y)<1,`y=${projected.y} leaves the viewport`);
   assert(projected.z>-1&&projected.z<1,`height is clipped by near/far: z=${projected.z}`);
  }
  assert(framed.maxDistance>=framed.distance,'OrbitControls must not clamp away the fitted distance');
 });
}

test('overview expands far clipping for a translated, scaled full-height scan',()=>{
 const box=bounds.clone().translate(new Vector3(300,-20,80));
 box.expandByVector(new Vector3(40,120,40));
 const camera=new PerspectiveCamera(67,.25,.04,30);
 const framed=fit(camera,box);
 assert(camera.far>=framed.distance+box.getSize(new Vector3()).length());
 for(const corner of corners(box)){
  const p=corner.project(camera);
  assert(Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z>-1&&p.z<1);
 }
});

test('overview refits a desktop camera after changing to portrait aspect',()=>{
 const camera=new PerspectiveCamera(67,16/9,.04,150);
 const desktop=fit(camera,bounds);
 camera.aspect=390/844;
 const portrait=fit(camera,bounds);
 assert(portrait.distance>desktop.distance);
 for(const corner of corners(bounds)){
  const p=corner.project(camera);
  assert(Math.abs(p.x)<1&&Math.abs(p.y)<1);
 }
});

test('overview keeps scan x horizontal rather than rotating the room diagonally',()=>{
 const camera=new PerspectiveCamera(67,16/9,.04,150);
 const framed=fit(camera,bounds);
 const center=framed.target.clone().project(camera);
 const alongX=framed.target.clone().add(new Vector3(1,0,0)).project(camera);
 assert(alongX.x>center.x);
 assert(Math.abs(alongX.y-center.y)<1e-8,'scan x must not tilt diagonally across the screen');
});

test('switching view flushes old damping without changing the current camera pose',()=>{
 const camera=new PerspectiveCamera(67,16/9,.04,150);camera.position.set(5,3,4);
 const orbit=new OrbitControls(camera);orbit.target.set(1,1,1);orbit.enableDamping=true;
 orbit.autoRotate=true;orbit.update();orbit.autoRotate=false;
 const position=camera.position.clone(),rotation=camera.quaternion.clone(),target=orbit.target.clone();
 clearOrbitMotion(camera,orbit);orbit.update();
 assert(camera.position.distanceTo(position)<1e-9);
 assert(camera.quaternion.angleTo(rotation)<1e-7);
 assert(orbit.target.distanceTo(target)<1e-9);
 assert.equal(orbit.enableDamping,true);
});

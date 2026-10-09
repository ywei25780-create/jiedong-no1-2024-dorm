import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Vector3,Euler,Quaternion} from 'three';
import {Group,Mesh,BoxGeometry,MeshBasicMaterial,Texture} from 'three';
import {disposeObject} from '../app/classroom/resources.ts';
import {assetURL,validateHotspots,selectMedia,canStand,localToWorld,worldToLocal,resolvePublished,validateSettings} from '../app/classroom/data.ts';
const base='https://example.org/jiedong-no1-2024-dorm/';
const document={schemaVersion:1,spaceId:'classroom',coordinateSpace:'model-local',hotspots:[{id:'desk-1',title:'待补充回忆',description:'',date:'2023-06',position:[1,.8,2],tags:['课桌'],media:[]}]};
test('media paths stay under Pages base and reject local/script/traversal URLs',()=>{
 assert.equal(assetURL('memories/desk.jpg',base),base+'memories/desk.jpg');
 for(const path of ['javascript:alert(1)','C:/Users/name/a.jpg','../secret.jpg','/etc/a','data:text/html,x','memories/%2e%2e/%2e%2e/x']) assert.throws(()=>assetURL(path,base));
});
test('JSON import validates every hotspot before replacing a draft',()=>{
 assert.equal(validateHotspots(document).hotspots[0].title,'待补充回忆');
 for(const bad of [{...document,coordinateSpace:'world'},{...document,hotspots:[{...document.hotspots[0],position:[NaN,0,0]}]},{...document,hotspots:[document.hotspots[0],document.hotspots[0]]},{...document,hotspots:[{...document.hotspots[0],media:[{id:'x',type:'image',src:'javascript:x'}]}]}]) assert.throws(()=>validateHotspots(bad));
});
test('memory dates reject impossible months and days',()=>{
 for(const date of ['2023-99','2023-02-29','2023-06-31'])assert.throws(()=>validateHotspots({...document,hotspots:[{...document.hotspots[0],date}]}));
 assert.equal(validateHotspots({...document,hotspots:[{...document.hotspots[0],date:'2024-02-29'}]}).hotspots[0].date,'2024-02-29');
});
test('media chronology and year filters retain undated entries without inventing dates',()=>{
 const media=[{id:'a',type:'image',src:'memories/a.jpg',caption:'',date:'2023-06'},{id:'b',type:'audio',src:'memories/b.mp3',caption:'',date:'2022-10'},{id:'c',type:'video',src:'memories/c.mp4',caption:'',date:''}] as const;
 assert.deepEqual(selectMedia([...media],'all','asc').map(m=>m.id),['b','a','c']);
 assert.deepEqual(selectMedia([...media],'2023','desc').map(m=>m.id),['a']);
 assert.deepEqual(selectMedia([...media],'undated','asc').map(m=>m.id),['c']);
});
test('hotspot local coordinates follow model translation rotation and scale',()=>{
 const matrix=new Matrix4().compose(new Vector3(10,1,-5),new Quaternion().setFromEuler(new Euler(0,Math.PI/2,0)),new Vector3(2,2,2));
 const position:[number,number,number]=[1,.8,2];const world=localToWorld(position,matrix);
 assert.ok(new Vector3(...world).distanceTo(new Vector3(14,2.6,-7))<1e-6);
 assert.ok(new Vector3(...worldToLocal(world,matrix)).distanceTo(new Vector3(...position))<1e-6);
});
test('navigation blocks desks and outer boundary while allowing aisle',()=>{
 const nav={x0:0,z0:0,width:3,height:3,resolution:1,cells:[0,0,0,0,1,0,0,1,0]};
 assert.equal(canStand(1.5,1.5,nav),true);assert.equal(canStand(.5,1.5,nav),false);assert.equal(canStand(3,2,nav),false);assert.equal(canStand(-.1,1.5,nav),false);
});
test('a late public response cannot overwrite edits made after its request',()=>{
 const published={...document,hotspots:[]};const draft=validateHotspots(document);
 assert.equal(resolvePublished(published,draft,0,1),draft);
 assert.equal(resolvePublished(published,draft,0,0),published);
});
test('developer settings reject nonfinite values and test the new collision radius',()=>{
 const settings={floorY:0,eyeHeight:1.65,speed:1.3,sprintMultiplier:1.75,radius:.16,spawn:[1,1.65,1] as [number,number,number],yaw:0};
 assert.equal(validateSettings(settings,(_x,_z,r)=>r<=.2).radius,.16);
 assert.throws(()=>validateSettings({...settings,radius:.5},(_x,_z,r)=>r<=.2));
 for(const key of ['eyeHeight','speed','radius','yaw','sprintMultiplier'] as const)assert.throws(()=>validateSettings({...settings,[key]:NaN},()=>true));
});
test('shared GLTF materials textures and decoded bitmaps are released exactly once',()=>{
 const root=new Group();const geometry=new BoxGeometry();const texture=new Texture();let closed=0,disposedTexture=0,disposedMaterial=0,disposedGeometry=0;
 texture.source.data={close(){closed++}};texture.addEventListener('dispose',()=>disposedTexture++);geometry.addEventListener('dispose',()=>disposedGeometry++);
 const material=new MeshBasicMaterial({map:texture});material.addEventListener('dispose',()=>disposedMaterial++);root.add(new Mesh(geometry,material),new Mesh(geometry,material));
 disposeObject(root);assert.equal(closed,1);assert.equal(disposedTexture,1);assert.equal(disposedMaterial,1);assert.equal(disposedGeometry,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadClassroomBootstrap as load} from '../app/classroom/bootstrap.ts';

const baseURL='https://example.test/jiedong-no1-2024-dorm/';
const bundledScene=JSON.parse(await readFile(new URL('../public/data/classroom-scene.json',import.meta.url),'utf8'));
const bundledModel=JSON.parse(await readFile(new URL('../public/data/classroom-model.json',import.meta.url),'utf8'));
const bundledNavigation=JSON.parse(await readFile(new URL('../public/data/classroom-navigation.json',import.meta.url),'utf8'));
const defaults={bundledScene,bundledModel,bundledNavigation,resolveURL:(path:string)=>new URL(path,baseURL).href};
const response=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const fetchFn=(fn:(url:string,init?:RequestInit)=>Response|Promise<Response>)=>(async(url,init)=>fn(String(url),init)) as typeof fetch;

test('the default scan enters with bundled navigation when the navigation network is unavailable',async()=>{
 let navigationRequested=false;
 const result=await load({...defaults,fetcher:fetchFn(url=>{
  if(url.endsWith('classroom-scene.json'))return response(bundledScene);
  if(url.endsWith('classroom-model.json'))return response(bundledModel);
  navigationRequested=true;throw new TypeError('navigation is unavailable');
 })});
 assert.deepEqual(result.navigation,bundledNavigation);
 assert.equal(result.model.sha256,bundledModel.sha256);
 assert.equal(navigationRequested,false);
});

test('scene and model metadata start together instead of blocking one another',async()=>{
 let releaseScene:((r:Response)=>void)|undefined;
 const remoteScene={...bundledScene,yaw:.25};
 const result=await load({...defaults,configTimeoutMs:100,fetcher:fetchFn(url=>{
  if(url.endsWith('classroom-scene.json'))return new Promise(resolve=>{releaseScene=resolve});
  if(url.endsWith('classroom-model.json')){releaseScene?.(response(remoteScene));return response(bundledModel)}
  throw Error('unexpected navigation request');
 })});
 assert.equal(result.scene.yaw,.25);
});

test('hung metadata requests terminate and use the bundled release without fetching navigation',async()=>{
 let aborted=0;
 const result=await load({...defaults,configTimeoutMs:20,fetcher:fetchFn((_url,init)=>new Promise((_resolve,reject)=>{
  init!.signal!.addEventListener('abort',()=>{aborted++;reject(init!.signal!.reason)},{once:true});
 }))});
 assert.deepEqual(result.scene,bundledScene);
 assert.deepEqual(result.model,bundledModel);
 assert.deepEqual(result.navigation,bundledNavigation);
 assert.equal(aborted,2);
});

test('a new model hash must fetch matching navigation instead of silently using the old grid',async()=>{
 const model={...bundledModel,sha256:'1'.repeat(64)};
 await assert.rejects(load({...defaults,fetcher:fetchFn(url=>{
  if(url.endsWith('classroom-scene.json'))return response(bundledScene);
  if(url.endsWith('classroom-model.json'))return response(model);
  return new Response(null,{status:503});
 })}),/资源读取失败/);
});

test('custom navigation receives its own longer timeout and returns the requested grid',async()=>{
 const scene={...bundledScene,navigation:'data/custom-navigation.json'};
 const navigation={...bundledNavigation,floorY:12};
 const result=await load({...defaults,configTimeoutMs:5,navigationTimeoutMs:100,fetcher:fetchFn(url=>{
  if(url.endsWith('classroom-scene.json'))return response(scene);
  if(url.endsWith('classroom-model.json'))return response(bundledModel);
  assert.equal(url,baseURL+'data/custom-navigation.json');
  return new Promise(resolve=>setTimeout(()=>resolve(response(navigation)),20));
 })});
 assert.equal(result.navigation.floorY,12);
});

test('a hung custom navigation request times out without substituting bundled navigation',async()=>{
 const scene={...bundledScene,navigation:'data/custom-navigation.json'};
 await assert.rejects(load({...defaults,navigationTimeoutMs:20,fetcher:fetchFn((url,init)=>{
  if(url.endsWith('classroom-scene.json'))return response(scene);
  if(url.endsWith('classroom-model.json'))return response(bundledModel);
  return new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true}));
 })}),{name:'TimeoutError'});
});

test('leaving during metadata loading cannot fall back to a successful old scene',async()=>{
 const controller=new AbortController();let succeeded=false;
 const request=load({...defaults,signal:controller.signal,fetcher:fetchFn(url=>new Promise(resolve=>{
  setTimeout(()=>resolve(response(url.endsWith('classroom-scene.json')?bundledScene:bundledModel)),10);
 }))}).then(value=>{succeeded=true;return value});
 controller.abort();
 await assert.rejects(request,{name:'AbortError'});
 assert.equal(succeeded,false);
});

test('an already cancelled scene does not issue metadata requests',async()=>{
 const controller=new AbortController();controller.abort();let requested=false;
 await assert.rejects(load({...defaults,signal:controller.signal,fetcher:fetchFn(()=>{requested=true;return response(bundledScene)})}),{name:'AbortError'});
 assert.equal(requested,false);
});

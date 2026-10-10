import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadModelBlob,readModelConfig,cacheKey,getSources,validateConfig,ModelDownloadError,type ModelConfig,type ModelProgress} from '../app/model-download.ts';

const baseURL='https://example.test/jiedong-no1-2024-dorm/';
async function fixture(size=24) {
  const bytes=new Uint8Array(size),h=new DataView(bytes.buffer);
  h.setUint32(0,0x46546c67,true);h.setUint32(4,2,true);h.setUint32(8,size,true);
  h.setUint32(12,size-20,true);h.setUint32(16,0x4e4f534a,true);bytes.fill(0x20,20);bytes.set(new TextEncoder().encode('{}'),20);
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const config:ModelConfig={modelId:'dorm',version:'test-v1',sha256:hash,expectedBytes:size,sources:{domestic:['https://domestic.test/dorm.glb'],backup:['https://backup.test/dorm.glb'],githubPages:'assets/repaired.glb'},timeouts:{firstByteMs:40,idleMs:40,totalMs:400}};
  return {bytes,config};
}
function storage() {
  const entries=new Map<string,Response>();let deletes=0;
  const cache={async match(k:string){return entries.get(k)?.clone()},async put(k:string,r:Response){entries.set(k,r.clone())},async delete(k:string){deletes++;return entries.delete(k)}};
  return {entries,cache,get deletes(){return deletes},api:{async open(){return cache}} as unknown as CacheStorage};
}
function response(bytes:Uint8Array,headerLength=bytes.length) {
  return new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,8));c.enqueue(bytes.slice(8,16));c.enqueue(bytes.slice(16));c.close()}}),{headers:{'Content-Length':String(headerLength)}});
}
function fetchFn(fn:(url:string,init?:RequestInit)=>Promise<Response>|Response):typeof fetch {
  return (async(url,init)=>fn(String(url),init)) as typeof fetch;
}
async function settlesWithin<T>(operation:Promise<T>,ms=200):Promise<T>{
 let timer:ReturnType<typeof setTimeout>;
 try{return await Promise.race([operation,new Promise<never>((_,reject)=>{
  timer=setTimeout(()=>reject(new Error(`Download did not settle within ${ms} ms`)),ms);
 })])}finally{clearTimeout(timer!)}
}

test('priority, deduplication and same-origin fallback are deterministic',async()=>{
 const {config}=await fixture();config.sources.domestic.push('',config.sources.domestic[0],new URL('assets/repaired.glb',baseURL).href);
 assert.deepEqual(getSources(config,baseURL).map(s=>s.label),['国内镜像 1','备用镜像 1','GitHub Pages']);
 config.sources.githubPages='https://external.test/model.glb';assert.throws(()=>getSources(config,baseURL),/本站模型/);
});
test('HTTP failure and CORS/network rejection fall through to GitHub; progress counts streamed bytes',async()=>{
 const {config,bytes}=await fixture();const calls:string[]=[];const progress:ModelProgress[]=[];
 const result=await loadModelBlob(config,{baseURL,cacheStorage:null,onProgress:p=>progress.push(p),fetcher:fetchFn((url,init)=>{
  calls.push(url);assert.equal(init?.mode,'cors');assert.equal(init?.credentials,'omit');
  if(url.includes('domestic'))return new Response('unavailable',{status:503});
  if(url.includes('backup'))throw new TypeError('Failed to fetch');return response(bytes,9999);
 })});
 assert.equal(calls.length,3);assert.equal(result.source,'GitHub Pages');assert.equal(result.blob.size,24);
 assert.deepEqual(progress.filter(p=>p.phase==='downloading').map(p=>p.loaded),[8,16,24]);
 assert(progress.every(p=>p.total===24));assert.equal(progress.filter(p=>p.phase==='switching').length,2);
});
test('empty mirrors send only one request to existing Pages GLB',async()=>{
 const {config,bytes}=await fixture();config.sources.domestic=[];config.sources.backup=[];let count=0;
 await loadModelBlob(config,{baseURL,cacheStorage:null,fetcher:fetchFn(url=>{count++;assert.equal(url,baseURL+'assets/repaired.glb');return response(bytes)})});assert.equal(count,1);
});
test('first byte timeout bounds a hung connection even when fetch ignores abort',async()=>{
 const {config}=await fixture();let aborted=false;
 await assert.rejects(settlesWithin(loadModelBlob(config,{baseURL,cacheStorage:null,fetcher:fetchFn((url,init)=>{
  if(!url.includes('domestic'))return new Response(null,{status:503});
  init!.signal!.addEventListener('abort',()=>{aborted=true},{once:true});
  return new Promise<Response>(()=>{});
 })})),e=>{
  assert(e instanceof ModelDownloadError);assert.equal(e.code,'all-sources-failed');assert(e.message.includes('等待模型数据超时'));return true;
 });assert(aborted);
});
test('body inactivity timeout bounds a partially received response that ignores abort',async()=>{
 const {config,bytes}=await fixture();let aborted=false;
 await assert.rejects(settlesWithin(loadModelBlob(config,{baseURL,cacheStorage:null,fetcher:fetchFn((url,init)=>{
  if(!url.includes('domestic'))return new Response(null,{status:503});
  return new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,8));init!.signal!.addEventListener('abort',()=>{aborted=true},{once:true})}}));
 })})),e=>{
  assert(e instanceof ModelDownloadError);assert.equal(e.code,'all-sources-failed');assert(e.message.includes('下载中断，长时间没有收到数据'));return true;
 });assert(aborted);
});
test('total timeout bounds a source that keeps trickling data',async()=>{
 const {config,bytes}=await fixture();config.timeouts.totalMs=40;config.timeouts.idleMs=30;let aborted=false;
 await assert.rejects(settlesWithin(loadModelBlob(config,{baseURL,cacheStorage:null,fetcher:fetchFn((url,init)=>{
  if(!url.includes('domestic'))return new Response(null,{status:503});
  return new Response(new ReadableStream({start(c){let i=0;const t=setInterval(()=>c.enqueue(bytes.slice(i,i+=1)),8);init!.signal!.addEventListener('abort',()=>{clearInterval(t);aborted=true},{once:true})}}));
 })})),e=>{
  assert(e instanceof ModelDownloadError);assert.equal(e.code,'all-sources-failed');assert(e.message.includes('当前下载源超过总时限'));return true;
 });assert(aborted);
});
test('HTML, truncated files and wrong hashes are rejected before caching or parsing',async()=>{
 const {config,bytes}=await fixture();config.sources.domestic=['https://html.test/model','https://short.test/model','https://hash.test/model'];config.sources.backup=[];let count=0;const st=storage();
 const r=await loadModelBlob(config,{baseURL,cacheStorage:st.api,fetcher:fetchFn(url=>{count++;
  if(url.includes('html'))return new Response('x'.repeat(24));
  if(url.includes('short'))return new Response(bytes.slice(0,20));
  if(url.includes('hash')){const wrong=bytes.slice();wrong[23]=9;return new Response(wrong)}
  return response(bytes);
 })});assert.equal(count,4);assert.equal(r.source,'GitHub Pages');assert.equal(st.entries.size,1);
});
test('cache hit avoids every model network request',async()=>{
 const {config,bytes}=await fixture();const st=storage();let count=0;
 const options={baseURL,cacheStorage:st.api,fetcher:fetchFn(()=>{count++;return response(bytes)})};
 assert.equal((await loadModelBlob(config,options)).cacheStored,true);
 const firstLoadCalls=count;assert.equal(firstLoadCalls,3);
 const progress:ModelProgress[]=[];const second=await loadModelBlob(config,{...options,onProgress:p=>progress.push(p)});
 assert(second.fromCache);assert.equal(count,firstLoadCalls);assert(progress.some(p=>p.phase==='cached'&&p.loaded===24));
});
test('version or hash changes bypass previous cache, including when mirror URL stays the same',async()=>{
 const {config,bytes}=await fixture();const st=storage();const calls:string[]=[];let current=bytes;
 const options={baseURL,cacheStorage:st.api,fetcher:fetchFn(url=>{calls.push(url);return response(current)})};
 const urls=getSources(config,baseURL).map(source=>source.url);
 await loadModelBlob(config,options);assert.deepEqual(calls,urls);
 const next={...config,version:'test-v2'};await loadModelBlob(next,options);assert.deepEqual(calls,[...urls,...urls]);
 current=bytes.slice();current[23]=10;const hash=Buffer.from(await crypto.subtle.digest('SHA-256',current)).toString('hex');
 await loadModelBlob({...next,sha256:hash},options);assert.deepEqual(calls,[...urls,...urls,...urls]);
});
test('corrupt local cache is removed and recovered from a source',async()=>{
 const {config,bytes}=await fixture();const st=storage();st.entries.set(cacheKey(config,baseURL),new Response('broken'));
 const r=await loadModelBlob(config,{baseURL,cacheStorage:st.api,fetcher:fetchFn(()=>response(bytes))});
 assert.equal(st.deletes,1);assert.equal(r.fromCache,false);assert.equal(r.cacheStored,true);
});
test('storage permission and quota failures do not prevent loading',async()=>{
 const {config,bytes}=await fixture();
 const unavailable={async open(){throw new DOMException('denied','SecurityError')}} as unknown as CacheStorage;
 const r=await loadModelBlob(config,{baseURL,cacheStorage:unavailable,fetcher:fetchFn(()=>response(bytes))});assert.equal(r.cacheStored,false);
 const st=storage();st.cache.put=async()=>{throw new DOMException('full','QuotaExceededError')};
 const r2=await loadModelBlob(config,{baseURL,cacheStorage:st.api,fetcher:fetchFn(()=>response(bytes))});assert.equal(r2.cacheStored,false);assert.equal(r2.blob.size,24);
});
test('caller cancellation aborts transfer without starting another source',async()=>{
 const {config}=await fixture();const controller=new AbortController();let count=0;
 const promise=loadModelBlob(config,{baseURL,signal:controller.signal,cacheStorage:null,fetcher:fetchFn((_,init)=>{
  count++;return new Promise((_,reject)=>{init!.signal!.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});controller.abort()});
 })});await assert.rejects(promise,{name:'AbortError'});assert.equal(count,1);
});
test('all sources failing produces a finite, actionable message without leaking query credentials',async()=>{
 const {config}=await fixture();config.sources.domestic[0]+='?signature=private-value';
 await assert.rejects(loadModelBlob(config,{baseURL,cacheStorage:null,fetcher:fetchFn(()=>new Response(null,{status:403}))}),e=>{
  assert(e instanceof ModelDownloadError);assert.equal(e.code,'all-sources-failed');assert(e.message.includes('HTTP 403'));assert(!e.message.includes('private-value'));return true;
 });
});
test('invalid configuration is explicit and does not silently reuse a stale model',async()=>{
 const {config}=await fixture();assert.throws(()=>validateConfig({...config,sha256:'wrong'}),/配置无效/);
});
test('unavailable config request falls back to the bundled release config',async()=>{
 const {config}=await fixture();const original=globalThis.fetch;
 try{globalThis.fetch=fetchFn(()=>{throw new TypeError('network offline')});assert.equal(await readModelConfig(config,baseURL),config)}finally{globalThis.fetch=original}
});
test('malformed config JSON reports the configuration error instead of ignoring mirror edits',async()=>{
 const {config}=await fixture();const original=globalThis.fetch;
 try{globalThis.fetch=fetchFn(()=>new Response('{invalid json'));await assert.rejects(readModelConfig(config,baseURL),/有效的 JSON/)}finally{globalThis.fetch=original}
});

for (const path of ['../public/model-sources.json','../public/data/classroom-model.json']) {
 test(`release ${path} tolerates slow first data and a temporary transfer pause`,async()=>{
  const {config,bytes}=await fixture();
  const release=JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8')) as ModelConfig;
  // Scale real release deadlines by 100 to reproduce a 14-second connection
  // and 18-second pause without making the test take half a minute.
  config.timeouts={firstByteMs:release.timeouts.firstByteMs/100,idleMs:release.timeouts.idleMs/100,totalMs:release.timeouts.totalMs/100};
  config.sources.domestic=[];config.sources.backup=[];
  const result=await loadModelBlob(config,{baseURL,cacheStorage:null,fetcher:fetchFn((_,init)=>new Promise((resolve,reject)=>{
   const connection=setTimeout(()=>resolve(new Response(new ReadableStream({start(c){
    c.enqueue(bytes.slice(0,8));
    const remainder=setTimeout(()=>{c.enqueue(bytes.slice(8));c.close()},180);
    init!.signal!.addEventListener('abort',()=>{clearTimeout(remainder);c.error(new DOMException('aborted','AbortError'))},{once:true});
   }}))),140);
   init!.signal!.addEventListener('abort',()=>{clearTimeout(connection);reject(new DOMException('aborted','AbortError'))},{once:true});
  }))});
  assert.equal(result.blob.size,24);assert.equal(result.source,'GitHub Pages');
 });
}

test('probe race selects Pages before the deadline when R2 fetch never settles or responds to abort',async()=>{
 const {config,bytes}=await fixture(12000);config.sources.domestic=[];
 config.timeouts={firstByteMs:500,idleMs:500,totalMs:1000};
 const calls:string[]=[];let loserAborted=false;
 const result=await settlesWithin(loadModelBlob(config,{baseURL,cacheStorage:null,fetcher:fetchFn((url,init)=>{
  calls.push(url);
  if(url.includes('backup')){
   init!.signal!.addEventListener('abort',()=>{loserAborted=true},{once:true});
   return new Promise<Response>(()=>{});
  }
  return response(bytes);
 })}));
 assert.equal(result.source,'GitHub Pages');assert.equal(result.blob.size,12000);assert(loserAborted);
 assert.deepEqual(calls,['https://backup.test/dorm.glb',baseURL+'assets/repaired.glb']);
});

test('probe race selects Pages when R2 receives less than 0.01 MB and then stops',async()=>{
 const {config,bytes}=await fixture(12000);config.sources.domestic=[];
 config.timeouts={firstByteMs:500,idleMs:500,totalMs:1000};
 const calls:string[]=[];
 const result=await settlesWithin(loadModelBlob(config,{baseURL,cacheStorage:null,fetcher:fetchFn(url=>{
  calls.push(url);
  return url.includes('backup')?new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,1000))}})):response(bytes);
 })}));
 assert.equal(result.source,'GitHub Pages');assert.equal(result.blob.size,12000);
 assert.deepEqual(calls,['https://backup.test/dorm.glb',baseURL+'assets/repaired.glb']);
});

test('probe race continues the winning stream without a new request and cancels the losing body',async()=>{
 const {config,bytes}=await fixture(12000);config.sources.domestic=[];
 config.timeouts={firstByteMs:500,idleMs:500,totalMs:1000};
 const calls:string[]=[];let loserCancelled=0;
 const result=await settlesWithin(loadModelBlob(config,{baseURL,cacheStorage:null,fetcher:fetchFn(url=>{
  calls.push(url);
  if(url.includes('backup'))return new Response(new ReadableStream({cancel(){loserCancelled++;return new Promise<void>(()=>{})}}));
  return new Response(new ReadableStream({start(controller){
   controller.enqueue(bytes.slice(0,10000));
   setTimeout(()=>{controller.enqueue(bytes.slice(10000));controller.close()},20);
  }}));
 })}));
 assert.equal(result.source,'GitHub Pages');assert.equal(result.blob.size,12000);assert.equal(loserCancelled,1);
 assert.deepEqual(calls,['https://backup.test/dorm.glb',baseURL+'assets/repaired.glb']);
});

test('wrong hash after a winning probe resumes a ready Pages stream kept beyond its idle deadline',async()=>{
 const {config,bytes}=await fixture(12000);config.sources.domestic=[];
 config.timeouts={firstByteMs:200,idleMs:40,totalMs:500};
 const wrong=bytes.slice();wrong[11999]=9;
 const calls:string[]=[],progress:ModelProgress[]=[];const st=storage();
 const result=await settlesWithin(loadModelBlob(config,{baseURL,cacheStorage:st.api,onProgress:p=>progress.push(p),fetcher:fetchFn((url,init)=>{
  calls.push(url);
  if(url.includes('backup'))return new Response(new ReadableStream({start(controller){
   controller.enqueue(wrong.slice(0,10000));let offset=10000;
   const trickle=setInterval(()=>{
    if(offset===wrong.length){clearInterval(trickle);controller.close();return}
    controller.enqueue(wrong.slice(offset,offset+=250));
   },10);
   init!.signal!.addEventListener('abort',()=>clearInterval(trickle),{once:true});
  }}));
  return new Promise<Response>(resolve=>setTimeout(()=>resolve(new Response(new ReadableStream({start(controller){
   controller.enqueue(bytes.slice(0,10000));controller.enqueue(bytes.slice(10000));controller.close();
  }}))),5));
 })}));
 assert.equal(progress.find(p=>p.phase==='downloading')?.source,'备用镜像 1');
 assert(progress.some(p=>p.phase==='switching'&&p.message.includes('模型校验不一致')));
 assert.equal(result.source,'GitHub Pages');assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),bytes);
 assert.deepEqual(calls,['https://backup.test/dorm.glb',baseURL+'assets/repaired.glb']);
 assert.equal(st.entries.size,1);assert.deepEqual(new Uint8Array(await st.entries.values().next().value!.arrayBuffer()),bytes);
});

test('a stalled winning body resumes the already ready Pages stream without another GET',async()=>{
 const {config,bytes}=await fixture(12000);config.sources.domestic=[];
 config.timeouts={firstByteMs:200,idleMs:40,totalMs:500};
 const calls:string[]=[],progress:ModelProgress[]=[];let stalledAborted=false;
 const result=await settlesWithin(loadModelBlob(config,{baseURL,cacheStorage:null,onProgress:p=>progress.push(p),fetcher:fetchFn((url,init)=>{
  calls.push(url);
  if(url.includes('backup')){
   init!.signal!.addEventListener('abort',()=>{stalledAborted=true},{once:true});
   return new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,10000))},cancel(){return new Promise<void>(()=>{})}}));
  }
  return new Promise<Response>(resolve=>setTimeout(()=>resolve(new Response(new ReadableStream({start(controller){
   controller.enqueue(bytes.slice(0,10000));controller.enqueue(bytes.slice(10000));controller.close();
  }}))),5));
 })}));
 assert.equal(progress.find(p=>p.phase==='downloading')?.source,'备用镜像 1');
 assert(progress.some(p=>p.phase==='switching'&&p.message.includes('下载中断，长时间没有收到数据')));
 assert.equal(result.source,'GitHub Pages');assert.equal(result.blob.size,12000);assert(stalledAborted);
 assert.deepEqual(calls,['https://backup.test/dorm.glb',baseURL+'assets/repaired.glb']);
});

test('caller cancellation exits hung probes without starting retries after cancellation',async()=>{
 const {config}=await fixture();config.sources.domestic=[];
 config.timeouts={firstByteMs:500,idleMs:500,totalMs:1000};
 const controller=new AbortController(),calls:string[]=[],signals:AbortSignal[]=[];let callsAtCancellation:string[]=[];
 const cancelTimer=setTimeout(()=>{callsAtCancellation=[...calls];controller.abort()},10);
 try{
  const operation=loadModelBlob(config,{baseURL,signal:controller.signal,cacheStorage:null,fetcher:fetchFn((url,init)=>{
   calls.push(url);signals.push(init!.signal!);return new Promise<Response>(()=>{});
  })});
  await assert.rejects(settlesWithin(operation,120),{name:'AbortError'});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.deepEqual(calls,callsAtCancellation);assert(calls.length>0&&calls.length<=2);assert(signals.every(signal=>signal.aborted));
 }finally{clearTimeout(cancelTimer)}
});

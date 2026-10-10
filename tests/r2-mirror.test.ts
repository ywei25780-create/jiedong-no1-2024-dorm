import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadModelBlob,validateConfig,type ModelProgress} from '../app/model-download.ts';
import {reserveDownload as reserve} from '../infra/r2-mirror/src/budget.ts';
import {handleMirrorRequest as serve} from '../infra/r2-mirror/src/gateway.ts';
const origin='https://ywei25780-create.github.io';
const limits={MONTHLY_BYTE_LIMIT:'10000000000',MONTHLY_REQUEST_LIMIT:'1000'};
const classroomBytes=18003044,dormBytes=9397120;
const october=new Date('2026-10-31T23:59:59.999Z');
type Transaction={get<T>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<void>};

class MemoryStorage{
 records=new Map<string,unknown>();
 failure:''|'get'|'put'|'commit'='';
 private tail=Promise.resolve();
 constructor(record?:unknown){if(record!==undefined)this.records.set('monthly',record)}
 transaction<T>(callback:(tx:Transaction)=>Promise<T>):Promise<T>{
  const operation=this.tail.then(async()=>{
   const next=new Map([...this.records].map(([key,value])=>[key,structuredClone(value)]));
   const tx:Transaction={
    get:async<T>(key:string)=>{if(this.failure==='get')throw Error('private storage read detail');await Promise.resolve();return structuredClone(next.get(key)) as T|undefined},
    put:async(key,value)=>{if(this.failure==='put')throw Error('private storage write detail');next.set(key,structuredClone(value))},
   };
   const result=await callback(tx);
   if(this.failure==='commit')throw Error('private commit detail');
   this.records=next;return result;
  });
  this.tail=operation.then(()=>{},()=>{});return operation;
 }
}
function environment(storage=new MemoryStorage(),config=limits,object?:{size:number;body:ReadableStream<Uint8Array>}){
 let reads=0,reservations=0;const instanceNames:string[]=[];
 const env={...config,
  MODELS:{async get(_key:string){reads++;return object??null}},
  DOWNLOAD_BUDGET:{idFromName(name:string){instanceNames.push(name);return name},get(_id:unknown){return {async reserve(bytes:number){reservations++;return reserve(storage,config,bytes,october)}}}},
 };
 return {env,storage,instanceNames,get reads(){return reads},get reservations(){return reservations}};
}
function request(path='/classroom.glb',method='GET',headers:Record<string,string>={}){return new Request('https://mirror.example'+path,{method,headers:{Origin:origin,...headers}})}
function safeguards(response:Response,allowed=true){
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
 assert(response.headers.get('Vary')?.split(',').map(v=>v.trim()).includes('Origin'));
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),allowed?origin:null);
}

test('the last whole download at the exact byte ceiling succeeds and the next is refused',async()=>{
 const storage=new MemoryStorage({month:'2026-10',bytes:10000000000-classroomBytes,requests:1});
 assert.deepEqual(await reserve(storage,limits,classroomBytes,october),{ok:true});
 assert.deepEqual(storage.records.get('monthly'),{month:'2026-10',bytes:10000000000,requests:2});
 assert.deepEqual(await reserve(storage,limits,dormBytes,october),{ok:false,status:429});
 assert.equal(storage.records.size,1);
});

test('the thousandth request succeeds and the next is refused below the byte ceiling',async()=>{
 const storage=new MemoryStorage({month:'2026-10',bytes:0,requests:999});
 assert.deepEqual(await reserve(storage,limits,dormBytes,october),{ok:true});
 assert.deepEqual(await reserve(storage,limits,dormBytes,october),{ok:false,status:429});
 assert.deepEqual(storage.records.get('monthly'),{month:'2026-10',bytes:dormBytes,requests:1000});
});

test('a UTC month boundary restores allowance by replacing the single record',async()=>{
 const storage=new MemoryStorage({month:'2026-10',bytes:10000000000,requests:1000});
 assert.deepEqual(await reserve(storage,limits,dormBytes,october),{ok:false,status:429});
 assert.deepEqual(await reserve(storage,limits,dormBytes,new Date('2026-11-01T00:00:00.000Z')),{ok:true});
 assert.deepEqual(storage.records.get('monthly'),{month:'2026-11',bytes:dormBytes,requests:1});
 assert.equal(storage.records.size,1);
});

test('100 concurrent reservations cannot exceed the byte budget',async()=>{
 const storage=new MemoryStorage();const config={...limits,MONTHLY_BYTE_LIMIT:String(classroomBytes*25)};
 const results=await Promise.all(Array.from({length:100},()=>reserve(storage,config,classroomBytes,october)));
 assert.equal(results.filter(result=>result.ok).length,25);
 assert.equal(results.filter(result=>!result.ok&&result.status===429).length,75);
 assert.deepEqual(storage.records.get('monthly'),{month:'2026-10',bytes:classroomBytes*25,requests:25});
});

test('invalid configuration and corrupt stored counters fail closed',async()=>{
 for(const config of [{...limits,MONTHLY_BYTE_LIMIT:'10000000001'},{...limits,MONTHLY_REQUEST_LIMIT:'1001'},{...limits,MONTHLY_BYTE_LIMIT:''},{...limits,MONTHLY_REQUEST_LIMIT:'NaN'}]){
  const storage=new MemoryStorage();assert.deepEqual(await reserve(storage,config,classroomBytes,october),{ok:false,status:503});assert.equal(storage.records.size,0);
 }
 for(const record of [{month:'2026-10',bytes:-1,requests:0},{month:'2026-10',bytes:0,requests:NaN},{month:'wrong',bytes:0,requests:0}]){
  assert.deepEqual(await reserve(new MemoryStorage(record),limits,classroomBytes,october),{ok:false,status:503});
 }
});

test('storage read write and commit failures never grant a download',async()=>{
 for(const failure of ['get','put','commit'] as const){
  const storage=new MemoryStorage();storage.failure=failure;
  assert.deepEqual(await reserve(storage,limits,classroomBytes,october),{ok:false,status:503});
  assert.equal(storage.records.size,0);
 }
});

test('exhausted allowance returns 429 before any R2 operation',async()=>{
 const binding=environment(new MemoryStorage({month:'2026-10',bytes:10000000000,requests:0}));
 const result=await serve(request(),binding.env);
 assert.equal(result.status,429);assert.equal(binding.reads,0);safeguards(result);
});

test('persistence failure returns a private 503 response without reading R2',async()=>{
 const storage=new MemoryStorage();storage.failure='commit';const binding=environment(storage);
 const result=await serve(request(),binding.env);
 assert.equal(result.status,503);assert.equal(binding.reads,0);safeguards(result);
 assert(!((await result.text()).includes('private')));
});

for(const status of [429,503] as const){
 test(`the downloader falls back to GitHub Pages after mirror ${status} without reading R2`,async()=>{
  const storage=status===429?new MemoryStorage({month:'2026-10',bytes:10000000000,requests:0}):new MemoryStorage();
  if(status===503)storage.failure='commit';
  const binding=environment(storage),mirrorURL='https://mirror.example/dorm.glb';
  const baseURL=origin+'/jiedong-no1-2024-dorm/';
  const release=validateConfig(JSON.parse(await readFile(new URL('../public/model-sources.json',import.meta.url),'utf8')));
  const config={...release,sources:{...release.sources,domestic:[],backup:[mirrorURL]}};
  const fallbackURL=new URL(config.sources.githubPages,baseURL).href;
  const bytes=await readFile(new URL('../public/assets/repaired.glb',import.meta.url));
  const calls:string[]=[],progress:ModelProgress[]=[];
  const result=await loadModelBlob(config,{baseURL,cacheStorage:null,onProgress:value=>progress.push(value),fetcher:(async input=>{
   const url=String(input);calls.push(url);
   if(url===mirrorURL){const response=await serve(request('/dorm.glb'),binding.env);assert.equal(response.status,status);safeguards(response);return response}
   assert.equal(url,fallbackURL);
   return new Response(bytes,{headers:{'Content-Type':'model/gltf-binary'}});
  }) as typeof fetch});
  assert.deepEqual(calls,[mirrorURL,fallbackURL]);
  assert.equal(binding.reservations,1);assert.equal(binding.reads,0);
  assert.equal(result.source,'GitHub Pages');assert.equal(result.fromCache,false);assert.equal(result.blob.size,dormBytes);
  // Pages can win the prefix race before the failed mirror response is selected.
  assert(progress.some(value=>value.phase==='downloaded'&&value.source==='GitHub Pages'&&value.loaded===dormBytes));
 });
}

test('invalid routes queries methods cookies and ranges never consume quota or touch R2',async()=>{
 const cases:[string,string,Record<string,string>,number][]=[
  ['/','GET',{},404],['/list','GET',{},404],['/%63lassroom.glb','GET',{},404],
  ['/classroom.glb?reset=1&month=2027-01','GET',{},400],['/classroom.glb?','GET',{},400],
  ['/classroom.glb','HEAD',{},405],['/dorm.glb','POST',{},405],
  ['/classroom.glb','GET',{Cookie:'session=ignored'},403],['/dorm.glb','GET',{Range:'bytes=0-100'},400],
 ];
 for(const [path,method,headers,status] of cases){
  const binding=environment();const result=await serve(request(path,method,headers),binding.env);
  assert.equal(result.status,status,path);assert.equal(binding.reads,0);assert.equal(binding.reservations,0);safeguards(result);
 }
});

test('untrusted or missing origins cannot consume quota and receive no allow-origin header',async()=>{
 for(const value of ['https://evil.example','https://ywei25780-create.github.io.evil.example','null','']){
  const binding=environment();const input=request();if(value)input.headers.set('Origin',value);else input.headers.delete('Origin');
  const result=await serve(input,binding.env);assert.equal(result.status,403);assert.equal(binding.reads,0);assert.equal(binding.reservations,0);safeguards(result,false);
 }
});

test('allowed GET preflight uses CORS without any budget or R2 operation',async()=>{
 const binding=environment();const result=await serve(request('/classroom.glb','OPTIONS',{'Access-Control-Request-Method':'GET'}),binding.env);
 assert.equal(result.status,204);assert.equal(result.headers.get('Access-Control-Allow-Methods'),'GET, OPTIONS');
 assert.equal(binding.reservations,0);assert.equal(binding.reads,0);safeguards(result);
});

test('preflight cannot authorize uploads or Range requests',async()=>{
 for(const headers of [{'Access-Control-Request-Method':'PUT'},{'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'range'}] as Record<string,string>[]){
  const binding=environment();const result=await serve(request('/classroom.glb','OPTIONS',headers),binding.env);
  assert(result.status>=400);assert.equal(binding.reads,0);assert.equal(binding.reservations,0);safeguards(result);
 }
});

test('only the specified localhost development origins are allowed',async()=>{
 for(const value of ['http://localhost:4174','http://127.0.0.1:4174']){
  const binding=environment();const result=await serve(request('/dorm.glb','OPTIONS',{Origin:value}),binding.env);
  assert.equal(result.status,204);assert.equal(result.headers.get('Access-Control-Allow-Origin'),value);assert.equal(binding.reads,0);
 }
 for(const value of ['http://localhost:4173','http://127.0.0.1:3000']){
  assert.equal((await serve(request('/dorm.glb','OPTIONS',{Origin:value}),environment().env)).status,403);
 }
});

test('missing bindings and rejected budget RPC fail closed before R2',async()=>{
 const binding=environment();const missing={...binding.env,DOWNLOAD_BUDGET:undefined};
 assert.equal((await serve(request(),missing)).status,503);assert.equal(binding.reads,0);
 const rejected={...binding.env,DOWNLOAD_BUDGET:{idFromName:()=>0,get:()=>({reserve:async()=>{throw Error('account token must not escape')}})}};
 const result=await serve(request(),rejected);assert.equal(result.status,503);assert.equal(binding.reads,0);safeguards(result);
 assert(!((await result.text()).includes('token')));
});

test('R2 size mismatch is refused and retains the full reservation',async()=>{
 let cancelled=false;const binding=environment(undefined,limits,{size:classroomBytes-1,body:new ReadableStream({cancel(){cancelled=true}})});
 const result=await serve(request(),binding.env);assert.equal(result.status,503);assert.equal(binding.reads,1);assert(cancelled);safeguards(result);
 assert.deepEqual(binding.storage.records.get('monthly'),{month:'2026-10',bytes:classroomBytes,requests:1});
});

test('R2 failure or absent object does not refund reservations',async()=>{
 for(const mode of ['missing','failed']){
  const binding=environment();if(mode==='failed')binding.env.MODELS.get=async()=>{throw Error('private account detail')};
  const result=await serve(request(),binding.env);assert.equal(result.status,503);safeguards(result);
  assert.deepEqual(binding.storage.records.get('monthly'),{month:'2026-10',bytes:classroomBytes,requests:1});
 }
});

test('cancelling a successful response does not reopen its reserved allowance',async()=>{
 const storage=new MemoryStorage({month:'2026-10',bytes:10000000000-classroomBytes,requests:0});
 const binding=environment(storage,limits,{size:classroomBytes,body:new ReadableStream()});
 const result=await serve(request(),binding.env);assert.equal(result.status,200);
 await result.body!.cancel();
 const next=await serve(request(),binding.env);assert.equal(next.status,429);assert.equal(binding.reads,1);
 assert.deepEqual(storage.records.get('monthly'),{month:'2026-10',bytes:10000000000,requests:1});
});

test('successful mirror responses preserve both real GLB byte lengths and SHA-256 values',async()=>{
 const instanceNames:string[]=[];
 for(const [path,file,size,hash] of [
  ['/classroom.glb','../public/models/classroom.glb',classroomBytes,'514d52df2db67e73497ec0e36eb68413557353d2d767151c225c11d20f86d16c'],
  ['/dorm.glb','../public/assets/repaired.glb',dormBytes,'2ebfd3f314b9e95ab78cdf98bfbc2a58025af8bdf2f73073ba4ed37444852f57'],
 ] as const){
  const original=await readFile(new URL(file,import.meta.url));const binding=environment(undefined,limits,{size,body:new Response(original).body!});
  const result=await serve(request(path),binding.env);assert.equal(result.status,200);safeguards(result);
  assert.equal(result.headers.get('Content-Type'),'model/gltf-binary');assert.equal(result.headers.get('Content-Length'),String(size));
  const bytes=new Uint8Array(await result.arrayBuffer());assert.equal(bytes.byteLength,size);assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
  assert.equal(binding.reads,1);assert.equal(binding.reservations,1);instanceNames.push(...binding.instanceNames);
 }
 assert.equal(new Set(instanceNames).size,1);
});

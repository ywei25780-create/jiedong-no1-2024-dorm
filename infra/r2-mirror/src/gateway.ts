import {budgetLimits,type BudgetSettings,type Reservation} from './budget.ts';

type ModelObject={size:number;body:ReadableStream<Uint8Array>};
type BudgetNamespace={idFromName(name:string):unknown;get(id:unknown):{reserve(bytes:number):Promise<Reservation>}};
export type MirrorEnv=BudgetSettings&{MODELS?:{get(key:string):Promise<ModelObject|null>};DOWNLOAD_BUDGET?:BudgetNamespace};
const origins=new Set(['https://ywei25780-create.github.io','http://localhost:4174','http://127.0.0.1:4174']);
const models:Record<string,{key:string;bytes:number}>={
 '/classroom.glb':{key:'classroom.glb',bytes:18003044},
 '/dorm.glb':{key:'dorm.glb',bytes:9397120},
};

export async function handleMirrorRequest(request:Request,env:MirrorEnv):Promise<Response>{
 const origin=request.headers.get('Origin');const allowed=origin!==null&&origins.has(origin);
 const headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'});
 if(allowed)headers.set('Access-Control-Allow-Origin',origin!);
 const error=(status:number)=>new Response(status===429?'Monthly download allowance exhausted.':'Mirror request unavailable.',{status,headers:new Headers([...headers,['Content-Type','text/plain; charset=utf-8']])});
 if(!allowed||request.headers.has('Cookie'))return error(403);
 const url=new URL(request.url);
 if(url.search||request.url.includes('?'))return error(400);
 const model=Object.hasOwn(models,url.pathname)?models[url.pathname]:undefined;
 if(!model)return error(404);
 if(request.headers.has('Range')||request.headers.has('If-Range'))return error(400);
 if(request.method==='OPTIONS'){
  const method=request.headers.get('Access-Control-Request-Method');
  if(method&&method!=='GET')return error(405);
  if(request.headers.get('Access-Control-Request-Headers')?.trim())return error(400);
  headers.set('Access-Control-Allow-Methods','GET, OPTIONS');
  headers.set('Vary','Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
  return new Response(null,{status:204,headers});
 }
 if(request.method!=='GET')return error(405);
 try{
  if(!budgetLimits(env)||!env.MODELS||!env.DOWNLOAD_BUDGET)return error(503);
  const id=env.DOWNLOAD_BUDGET.idFromName('global-monthly-download-budget');
  const reservation=await env.DOWNLOAD_BUDGET.get(id).reserve(model.bytes);
  if(reservation?.ok!==true)return error(reservation?.ok===false&&reservation.status===429?429:503);
  const object=await env.MODELS.get(model.key);
  if(!object||object.size!==model.bytes||!object.body){await object?.body?.cancel().catch(()=>{});return error(503)}
  headers.set('Content-Type','model/gltf-binary');headers.set('Content-Length',String(model.bytes));
  headers.set('Access-Control-Expose-Headers','Content-Length');headers.set('Accept-Ranges','none');
  return new Response(object.body,{status:200,headers});
 }catch{return error(503)}
}

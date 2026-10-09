import type {ModelConfig} from '../model-download';
import type {Navigation,Point,Settings} from './data';

export type ClassroomSceneConfig=Settings&{
 navigation:string;
 transform:{position:Point;rotationDegrees:Point;scale:number};
};
type BootstrapOptions={
 bundledScene:ClassroomSceneConfig;
 bundledModel:ModelConfig;
 bundledNavigation:Navigation;
 resolveURL:(path:string)=>string;
 signal?:AbortSignal;
 fetcher?:typeof fetch;
 configTimeoutMs?:number;
 navigationTimeoutMs?:number;
 onStage?:(message:string)=>void;
};

export async function loadClassroomBootstrap(options:BootstrapOptions){
 const {signal,bundledScene,bundledModel,bundledNavigation}=options;
 function checkCancelled(){if(signal?.aborted)throw signal.reason??new DOMException('教室加载已取消','AbortError')}
 async function json<T>(path:string,timeoutMs:number):Promise<T>{
  checkCancelled();
  const request=new AbortController();
  const cancel=()=>request.abort(signal?.reason??new DOMException('教室加载已取消','AbortError'));
  signal?.addEventListener('abort',cancel,{once:true});
  let rejectAbort:(reason:unknown)=>void=()=>{};
  const aborted=new Promise<never>((_resolve,reject)=>{rejectAbort=reject});
  const fail=()=>rejectAbort(request.signal.reason);
  request.signal.addEventListener('abort',fail,{once:true});
  const timer=setTimeout(()=>request.abort(new DOMException(`资源读取超时：${path}`,'TimeoutError')),timeoutMs);
  try{
   const operation=(async()=>{
    const response=await (options.fetcher??fetch)(options.resolveURL(path),{signal:request.signal,cache:'no-store'});
    if(!response.ok)throw Error(`资源读取失败：${path}`);
    return await response.json() as T;
   })();
   const value=await Promise.race([operation,aborted]);
   checkCancelled();return value;
  }finally{
   clearTimeout(timer);signal?.removeEventListener('abort',cancel);request.signal.removeEventListener('abort',fail);
  }
 }
 async function metadata<T>(path:string,fallback:T):Promise<T>{
  try{return await json<T>(path,options.configTimeoutMs??5000)}catch{checkCancelled();return fallback}
 }
 checkCancelled();options.onStage?.('正在准备教室配置…');
 const [scene,model]=await Promise.all([
  metadata('data/classroom-scene.json',bundledScene),
  metadata('data/classroom-model.json',bundledModel),
 ]);
 checkCancelled();
 // A different model or navigation path must obtain its matching grid remotely.
 const sameScan=typeof model.sha256==='string'&&model.sha256.toLowerCase()===bundledModel.sha256.toLowerCase();
 const useBundledNavigation=scene.navigation===bundledScene.navigation&&sameScan;
 options.onStage?.(useBundledNavigation?'教室导航已就绪，正在准备模型…':'正在读取教室导航…');
 const navigation=useBundledNavigation?bundledNavigation:await json<Navigation>(scene.navigation,options.navigationTimeoutMs??60000);
 checkCancelled();return {scene,model,navigation};
}

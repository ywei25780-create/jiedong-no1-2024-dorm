import {DurableObject} from 'cloudflare:workers';
import {reserveDownload} from './budget.ts';
import {handleMirrorRequest,type MirrorEnv} from './gateway.ts';

export class DownloadBudget extends DurableObject<MirrorEnv>{
 async reserve(bytes:number){return reserveDownload(this.ctx.storage,this.env,bytes)}
}

export default {fetch(request:Request,env:MirrorEnv){return handleMirrorRequest(request,env)}};

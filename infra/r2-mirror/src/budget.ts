export type BudgetSettings={MONTHLY_BYTE_LIMIT?:unknown;MONTHLY_REQUEST_LIMIT?:unknown};
export type Reservation={ok:true}|{ok:false;status:429|503};
export type BudgetRecord={month:string;bytes:number;requests:number};
export type BudgetTransaction={get<T>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<void>};
export type BudgetStorage={transaction<T>(callback:(tx:BudgetTransaction)=>Promise<T>):Promise<T>};

export function budgetLimits(settings:BudgetSettings){
 const parse=(value:unknown,ceiling:number)=>{
  if(typeof value!=='string'||!/^\d+$/.test(value))return undefined;
  const number=Number(value);return Number.isSafeInteger(number)&&number>0&&number<=ceiling?number:undefined;
 };
 const bytes=parse(settings.MONTHLY_BYTE_LIMIT,10000000000),requests=parse(settings.MONTHLY_REQUEST_LIMIT,1000);
 return bytes!==undefined&&requests!==undefined?{bytes,requests}:undefined;
}

export async function reserveDownload(storage:BudgetStorage,settings:BudgetSettings,bytes:number,now:Date=new Date()):Promise<Reservation>{
 try{
  const limits=budgetLimits(settings);
  if(!limits||!Number.isSafeInteger(bytes)||bytes<=0)return {ok:false,status:503};
  const month=now.toISOString().slice(0,7);
  return await storage.transaction(async tx=>{
   const previous=await tx.get<BudgetRecord>('monthly');
   if(previous!==undefined&&(!previous||!/^\d{4}-(0[1-9]|1[0-2])$/.test(previous.month)||previous.month>month||!Number.isSafeInteger(previous.bytes)||previous.bytes<0||previous.bytes>10000000000||!Number.isSafeInteger(previous.requests)||previous.requests<0||previous.requests>1000))return {ok:false,status:503};
   const current=previous?.month===month?previous:{month,bytes:0,requests:0};
   if(bytes>limits.bytes-current.bytes||current.requests>=limits.requests)return {ok:false,status:429};
   // One fixed record, and no refunds: a cancelled response still reserved its full object.
   await tx.put('monthly',{month,bytes:current.bytes+bytes,requests:current.requests+1});
   return {ok:true};
  });
 }catch{return {ok:false,status:503}}
}

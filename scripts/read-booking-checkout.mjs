import fs from 'node:fs/promises';
import {bookingCheckoutSnapshot,parseBookingCheckoutObservation} from '../src/ota-booking-checkout.mjs';
import {otaScope,mergeOtaAttempts} from '../src/ota-status.mjs';
const root=new URL('../',import.meta.url);
const config=JSON.parse(await fs.readFile(new URL('config/stays.json',root),'utf8'));
const stay=config.stays.find(x=>x.id===process.env.STAY_IDS);
if(!stay||!process.env.OTA_CDP_URL)throw new Error('STAY_IDS 한 개와 전용 Chrome OTA_CDP_URL이 필요합니다.');
const allowed=url=>url.protocol==='https:'&&url.hostname==='secure.booking.com'&&url.pathname==='/book.html';
const endpoint=new URL(process.env.OTA_CDP_URL);
const version=await(await fetch(new URL('/json/version',endpoint),{signal:AbortSignal.timeout(5000)})).json();
const socketUrl=new URL(version.webSocketDebuggerUrl);socketUrl.hostname=endpoint.hostname;
const ws=new WebSocket(socketUrl);let seq=0;const pending=new Map();
ws.onmessage=e=>{const r=JSON.parse(e.data);pending.get(r.id)?.(r);};
await new Promise((r,j)=>{ws.onopen=r;ws.onerror=()=>j(new Error('CDP 연결 실패'));});
const send=(method,params={},sessionId)=>new Promise((r,j)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);j(new Error('CDP 단일 탭 읽기 시간 초과'));},20000);pending.set(id,x=>{clearTimeout(timer);pending.delete(id);x.error?j(new Error(`CDP ${method} 실패 (${x.error.code})`)):r(x.result);});ws.send(JSON.stringify({id,method,params,sessionId}));});
try{
 let targets=(await send('Target.getTargets')).targetInfos.filter(t=>{try{return t.type==='page'&&allowed(new URL(t.url));}catch{return false;}});
 let observation;
 for(const target of targets){
  const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  try{
   let result;
   for(let retry=0;retry<2;retry++){try{result=await send('Runtime.evaluate',{expression:`(async()=>{for(let i=0;i<20&&!document.querySelector('#bp-price-summary');i++)await new Promise(r=>setTimeout(r,500));return (${bookingCheckoutSnapshot.toString()})();})()`,awaitPromise:true,returnByValue:true},sessionId);
break;}catch(error){if(retry===1)throw error;await new Promise(r=>setTimeout(r,2000));}}
   const snapshot=result.result?.value;
   if(snapshot)observation=parseBookingCheckoutObservation(snapshot,stay);
   if(observation)break;
  }finally{await send('Target.detachFromTarget',{sessionId}).catch(()=>{});}
 }
 if(!observation){console.log('결제 화면의 호텔·날짜·총액을 확인하지 못했습니다. 기존 결과는 보존합니다.');process.exitCode=2;}
 else{
  const capturedAt=new Date().toISOString();
  const file=new URL('data/ota-status.json',root);const previous=JSON.parse(await fs.readFile(file,'utf8'));
  const old=previous.results?.find(x=>x.id===stay.id)?.providers?.find(x=>x.provider==='Booking.com'&&x.scope===otaScope(stay));
  const attempt={...(old??{}),provider:'Booking.com',scope:otaScope(stay),capturedAt,status:'pending',state:'checkout-total-observed',sourceOrigin:observation.sourceOrigin,checkoutObservation:{...observation,capturedAt}};
  delete attempt.lastSuccessful;
  await fs.writeFile(file,JSON.stringify(mergeOtaAttempts(previous,{capturedAt,results:[{id:stay.id,state:'direct-attempted',providers:[attempt]}]}),null,2)+'\n');
  console.log(JSON.stringify({id:stay.id,provider:'Booking.com',...observation},null,2));
 }
}finally{ws.close();}

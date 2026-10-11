import fs from 'node:fs/promises';
import {expediaCheckoutSnapshot,parseExpediaCheckoutObservation,expediaPreviewAction} from '../src/ota-expedia.mjs';
import {otaScope,mergeOtaAttempts} from '../src/ota-status.mjs';
const config=JSON.parse(await fs.readFile(new URL('../config/stays.json',import.meta.url),'utf8'));
const stay=config.stays.find(x=>x.id===process.env.STAY_IDS);
if(!stay||!process.env.OTA_CDP_URL)throw new Error('STAY_IDS 한 개와 OTA_CDP_URL이 필요합니다.');
const initial=new URL(stay.ota?.urls?.Expedia??'');
if(initial.protocol!=='https:'||!['www.expedia.com','www.expedia.co.kr'].includes(initial.hostname)||!initial.pathname.endsWith('.Hotel-Information'))throw new Error('검증된 Expedia 호텔 주소가 필요합니다.');
initial.hostname='www.expedia.co.kr';initial.search='';
const propertyId=initial.pathname.match(/\.h(\d+)\.Hotel-Information/)?.[1];
if(!propertyId)throw new Error('호텔 식별자 누락');
if(!/standard/i.test(stay.booked.room)||!/king/i.test(stay.booked.room))throw new Error('현재 직접 조회는 Standard King 설정만 지원합니다.');
const endpoint=process.env.OTA_CDP_URL;
const version=await(await fetch(endpoint+'/json/version',{signal:AbortSignal.timeout(5000)})).json();const url=new URL(version.webSocketDebuggerUrl);url.hostname=new URL(endpoint).hostname;
const ws=new WebSocket(url);let seq=0,target,session;const owned=[];const pending=new Map();ws.onmessage=e=>{const r=JSON.parse(e.data);pending.get(r.id)?.(r);};
await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
const send=(method,params={},sessionId)=>new Promise((r,j)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);j(new Error('timeout'));},20000);pending.set(id,x=>{clearTimeout(timer);pending.delete(id);x.error?j(new Error(`${method}:${x.error.code}`)):r(x.result);});ws.send(JSON.stringify({id,method,params,sessionId}));});
const read=async expr=>(await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true},session)).result?.value;
try{
 target=(await send('Target.createTarget',{url:initial.href,background:true})).targetId;
 owned.push(target);await send('Target.activateTarget',{targetId:target});
 session=(await send('Target.attachToTarget',{targetId:target,flatten:true})).sessionId;
 for(let i=0;i<35;i++){let ready=await read(`!!document.querySelector('[data-stid="uitk-date-selector-input1-default"]')||/show us your human side|captcha|access denied|사람인지|로봇/i.test(document.body?.innerText??'')`).catch(()=>false);if(ready)break;await new Promise(r=>setTimeout(r,600));}
 const rejected=await read(`(()=>{const button=[...document.querySelectorAll('button')].find(n=>n.innerText.trim()==='Reject All'&&n.getBoundingClientRect().width);if(!button)return false;button.click();return true;})()`);
 if(rejected)for(let i=0;i<10&&await read(`!![...document.querySelectorAll('button')].find(n=>n.innerText.trim()==='Reject All'&&n.getBoundingClientRect().width)`);i++)await new Promise(r=>setTimeout(r,300));
 const dateSelector='[data-stid="uitk-date-selector-input1-default"]';
 const control=await read(`(()=>{const n=document.querySelector(${JSON.stringify(dateSelector)});if(!n||!n.getBoundingClientRect().width)return null;n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
 if(!control){const info=await read(`({title:document.title,headings:[...document.querySelectorAll('h1,h2')].map(n=>n.innerText).slice(0,6),blocked:/show us your human side|access denied|verify you are human/i.test(document.body?.innerText??'')})`);console.log(JSON.stringify({initialPage:info}));throw new Error(info?.blocked?'blocked':'date-control-unavailable');}
 if(control){await read(`document.querySelector(${JSON.stringify(dateSelector)}).click()`);
 for(let i=0;i<12&&!await read(`!!document.querySelector('.uitk-month-table')`);i++)await new Promise(r=>setTimeout(r,400));
 const consentHandled=await read(`(()=>{const button=[...document.querySelectorAll('button')].find(n=>n.innerText.trim()==='Reject All'&&n.getBoundingClientRect().width);if(!button)return false;button.click();return true;})()`);
 if(consentHandled){
  for(let i=0;i<12&&await read(`!![...document.querySelectorAll('button')].find(n=>n.innerText.trim()==='Reject All'&&n.getBoundingClientRect().width)`);i++)await new Promise(r=>setTimeout(r,300));
  await read(`document.querySelector(${JSON.stringify(dateSelector)}).click()`);
  for(let i=0;i<12&&!await read(`!!document.querySelector('.uitk-month-table')`);i++)await new Promise(r=>setTimeout(r,400));
 }
 if(!await read(`!!document.querySelector('.uitk-month-table')`)){
  await read(`document.querySelector(${JSON.stringify(dateSelector)})?.click()`);
  for(let i=0;i<25&&!await read(`!!document.querySelector('.uitk-month-table')`);i++)await new Promise(r=>setTimeout(r,400));
 }
 if(!await read(`!!document.querySelector('.uitk-month-table')`))throw new Error('calendar-unavailable');
 for(const iso of [stay.checkIn,stay.checkOut]){
  const label=new Date(iso+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const daySelector='.uitk-day-aria-label[aria-label^="'+label+'"]';
  for(let i=0;i<12&&!await read(`!!document.querySelector(${JSON.stringify(daySelector)})`);i++){
   await read(`(()=>{const n=[...document.querySelectorAll('.uitk-month-table')].at(-1);n?.scrollIntoView({block:'end'});for(let a=n?.parentElement;a;a=a.parentElement){if(a.scrollHeight>a.clientHeight+50&&/auto|scroll/.test(getComputedStyle(a).overflowY)){a.scrollTop=a.scrollHeight;return true;}}return false;})()`);
   await new Promise(r=>setTimeout(r,500));
  }
  const chosen=await read(`(()=>{const label=document.querySelector(${JSON.stringify(daySelector)});const n=label?.closest('[role="button"],button');if(!n||n.getAttribute('aria-disabled')==='true')return false;n.scrollIntoView({block:'center'});n.click();return true;})()`);
  if(!chosen)throw new Error('date-unavailable');
 }
 const selectedDates=await read(`([...document.querySelectorAll('.uitk-day-button[aria-pressed="true"]')].map(n=>n.querySelector('.uitk-day-aria-label')?.getAttribute('aria-label')).filter(x=>/Selected start date|Selected end date/.test(x)))`);
 for(const [iso,marker] of [[stay.checkIn,'Selected start date'],[stay.checkOut,'Selected end date']]){const label=new Date(iso+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric',year:'numeric'});if(!selectedDates?.some(x=>x.startsWith(label)&&x.includes(marker)))throw new Error('selected-dates-unverified');}
 const closed=await read(`(()=>{const p=document.querySelector('.uitk-month-table')?.closest('[role="dialog"]');const n=[...(p?.querySelectorAll('button')??[])].find(n=>/^Cancel, close the date selector/.test(n.getAttribute('aria-label')??''));if(!n)return false;n.click();return true;})()`);if(!closed)throw new Error('calendar-close-unavailable');
 await new Promise(r=>setTimeout(r,1400));
 for(let i=0;i<35&&!await read(`!![...document.querySelectorAll('h1')].find(n=>/Properties in/.test(n.innerText))`);i++)await new Promise(r=>setTimeout(r,400));
 for(let i=0;i<30&&!await read(`!!document.querySelector('[data-stid="open-room-picker"]')`);i++)await new Promise(r=>setTimeout(r,400));
 await read(`document.querySelector('[data-stid="open-room-picker"]')?.click()`);
 for(let i=0;i<12&&!await read(`!!document.querySelector('[data-stid="rooms-traveler-selector-menu-container"]')?.getBoundingClientRect().width`);i++)await new Promise(r=>setTimeout(r,300));
 const occupancy=await read(`(()=>{const p=document.querySelector('[data-stid="rooms-traveler-selector-menu-container"]');return {adults:Number(p?.querySelector('input[aria-label="Adults"]')?.value),children:Number(p?.querySelector('input[aria-label="Children,Ages 0 to 17"]')?.value),rooms:p?.querySelectorAll('input[aria-label="Adults"]').length};})()`);
 if(occupancy.adults!==stay.adults||occupancy.children!==0||occupancy.rooms!==1){console.log(JSON.stringify({occupancy}));throw new Error('occupancy-unverified');}
 await read(`(()=>{const p=document.querySelector('[data-stid="rooms-traveler-selector-menu-container"]');[...(p?.querySelectorAll('button')??[])].find(n=>n.innerText.trim()==='Done')?.click();})()`);
 await read(`(()=>{const p=document.querySelector('[data-stid="sticky-search-form"]');[...(p?.querySelectorAll('button')??[])].find(n=>n.innerText.trim()==='Search')?.click();})()`);

 }
 let propertyHref;
 for(let i=0;i<20&&!propertyHref;i++){
  propertyHref=await read(`(()=>{return [...document.querySelectorAll('a[href]')].filter(n=>n.getBoundingClientRect().width).map(n=>n.href).find(href=>{try{const u=new URL(href);return u.hostname==='www.expedia.co.kr'&&u.pathname.includes('.h${propertyId}.Hotel-Information')&&u.searchParams.get('chkin')==='${stay.checkIn}'&&u.searchParams.get('chkout')==='${stay.checkOut}';}catch{return false;}});})()`);
  if(!propertyHref)await new Promise(r=>setTimeout(r,500));
 }
 if(!propertyHref)throw new Error('dated-hotel-link-unavailable');
 if(propertyHref){
  await send('Page.navigate',{url:propertyHref},session);
  for(let i=0;i<35;i++){
   const result=await read(`({blocked:/captcha|show us your human side|access denied/i.test(document.body?.innerText??''),roomPrices:!!document.querySelector('[data-stid="section-room-list"]')&&/Reserve|total|₩/.test(document.querySelector('[data-stid="section-room-list"]').innerText)})`).catch(()=>({}));
   if(result.blocked)throw new Error('blocked');
   if(result.roomPrices)break;
   await new Promise(r=>setTimeout(r,600));
  }
 }
 if(!await read(`(${expediaPreviewAction.toString()})('options')`))throw new Error('matching-options-unavailable');
 await new Promise(r=>setTimeout(r,800));
 if(!await read(`(${expediaPreviewAction.toString()})('room-preview')`))throw new Error('option-selection-unverified');
 let paymentPreview=false;
 for(let i=0;i<20;i++){
  if(await read(`(${expediaPreviewAction.toString()})('property-payment')`)){paymentPreview=true;break;}
  await new Promise(r=>setTimeout(r,300));
 }
 if(!paymentPreview)throw new Error('payment-preview-unavailable');
 let checkoutReady=false;
 for(let i=0;i<45;i++){
  const info=await read(`({checkout:location.pathname.startsWith('/checkout/'),ready:!!document.querySelector('[data-stid="price-summary-card"]'),blocked:/captcha|show us your human side|access denied/i.test(document.body?.innerText??'')})`).catch(()=>({}));
  if(info.blocked)throw new Error('blocked');
  if(info.checkout&&info.ready){checkoutReady=true;break;}
  const targets=(await send('Target.getTargets')).targetInfos;
  const popup=targets.find(n=>n.type==='page'&&n.openerId===target&&/^https:\/\/www\.expedia\.(co\.kr|com)\//.test(n.url));
  if(popup&&!owned.includes(popup.targetId)){owned.push(popup.targetId);session=(await send('Target.attachToTarget',{targetId:popup.targetId,flatten:true})).sessionId;}
  await new Promise(r=>setTimeout(r,700));
 }
 if(!checkoutReady)throw new Error('checkout-preview-unavailable');
 const snapshot=await read(`(${expediaCheckoutSnapshot.toString()})()`);
 const result=snapshot&&parseExpediaCheckoutObservation(snapshot,stay);
 if(!result||result.adults!==stay.adults||result.rooms!==1)throw new Error('checkout-total-unverified');
 result.discovery='hotel-search-ui';result.capturedAt=new Date().toISOString();
 result.children=0;
 result.paymentTiming='property';result.paymentEvidence='property-payment-preview-ui';
 const file=new URL('../data/ota-status.json',import.meta.url);
 const previous=JSON.parse(await fs.readFile(file,'utf8'));
 const capturedAt=result.capturedAt;
 const attempt={provider:'Expedia',scope:otaScope(stay),capturedAt,status:'pending',state:'checkout-total-observed',sourceOrigin:result.sourceOrigin,checkoutObservation:result};
 await fs.writeFile(file,JSON.stringify(mergeOtaAttempts(previous,{capturedAt,results:[{id:stay.id,state:'direct-attempted',providers:[attempt]}]}),null,2)+'\n');
 console.log(JSON.stringify({id:stay.id,...result}));
}catch(e){
 const capturedAt=new Date().toISOString();
 const state=String(e.message).match(/^[a-z-]+$/)?e.message:'direct-search-failed';
 const file=new URL('../data/ota-status.json',import.meta.url);
 const previous=JSON.parse(await fs.readFile(file,'utf8'));
 await fs.writeFile(file,JSON.stringify(mergeOtaAttempts(previous,{capturedAt,results:[{id:stay.id,state:'direct-attempted',providers:[{provider:'Expedia',scope:otaScope(stay),capturedAt,status:'error',state}]}]}),null,2)+'\n');
 console.log(JSON.stringify({id:stay.id,state}));process.exitCode=2;}finally{for(const id of owned)await send('Target.closeTarget',{targetId:id}).catch(()=>{});ws.close();}

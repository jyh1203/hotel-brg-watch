import {localInstant,reservationScope} from '../site/claim-plan.js';
import {roomOnlyFromBreakdown,assess} from '../site/brg.js';
import {freshObservation} from '../site/brg-readiness.js';
export const precisionScope=reservationScope;
const compact=s=>String(s??'').replace(/\s+/g,' ').trim();
const numeric=s=>Number(String(s).replaceAll(',',''));
const MONTHS={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
export function parseExactCancellation(text,{year,timeZone,datesVerified=false}={}){
 const t=compact(text);let local=null,penalty=null;
 const ko=t.match(/(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2}):(\d{2})\s*전까지[^.]*전액 환불/);
 if(ko&&datesVerified&&Number.isInteger(year)&&/숙박 시설의 현지 시간/.test(t))local=`${year}-${ko[1].padStart(2,'0')}-${ko[2].padStart(2,'0')} ${ko[3].padStart(2,'0')}:${ko[4]}`;
 const en=t.match(/(?:no charge|free)[^.]*before\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s+local hotel time on\s+([A-Za-z]+)\s+(\d{1,2}),?\s*(20\d{2})/i);
 if(en&&datesVerified&&MONTHS[en[4].toLowerCase()]){const h=(+en[1]%12)+(/pm/i.test(en[3])?12:0);local=`${en[6]}-${String(MONTHS[en[4].toLowerCase()]).padStart(2,'0')}-${en[5].padStart(2,'0')} ${String(h).padStart(2,'0')}:${en[2]}`;}
 const deadline=localInstant(local,timeZone);
 if(/첫\s*1박 요금과 세금 및 수수료|(?:one|1) night(?:'s)?(?: room)?(?: rate| charge| fee)?(?: plus| and| including|,)[^.]*tax/i.test(t))penalty={kind:'first-night',taxesIncluded:true};
 else if(/첫\s*1박|(?:one|1) night(?:'s)?(?: room)? (?:charge|rate|fee)/i.test(t))penalty={kind:'first-night',taxesIncluded:null};
 else if(/전체 숙박 요금|full (?:stay|reservation)|entire stay/i.test(t))penalty={kind:'full-stay',taxesIncluded:null};
 if(!penalty){const fixed=t.match(/assess a fee of\s+([\d,.]+)\s+([A-Z]{3})\s+if you must cancel after this deadline/i);if(fixed)penalty={kind:'fixed-amount',amount:numeric(fixed[1]),currency:fixed[2].toUpperCase(),taxesIncluded:null};}
 return {freeUntil:deadline,penalty,evidence:t.slice(0,3000),verified:Boolean(deadline&&penalty)};
}
export function parseHotelsPrice(text,currency='EUR'){
 if(currency!=='EUR')return null;
 const t=compact(text);if(/쿠폰|할인 코드|프로모션 코드|credit|discount applied/i.test(t))return null;
 const euro='€\\s*([\\d,]+(?:\\.\\d{1,2})?)';
 const total=t.match(new RegExp('총\\s*금액\\s*'+euro));const tax=t.match(new RegExp('(?:^|[^지])세금\\s*'+euro));const local=t.match(new RegExp('현지세\\s*'+euro));
 if(!total||!tax||/수수료\s*€|봉사료\s*€|세금[^€]*별도|별도[^€]*세금/.test(t))return null;
 const before=t.slice(0,t.indexOf('세금'));const amounts=[...before.matchAll(new RegExp(euro,'g'))];if(amounts.length<2)return null;
 const room=numeric(amounts.at(-1)[1]),taxAmount=numeric(tax[1]),localAmount=local?numeric(local[1]):0,totalAmount=numeric(total[1]);
 if(room<=0||taxAmount<0||localAmount<0||Math.abs(room+taxAmount+localAmount-totalAmount)>.005)return null;
 const priceBreakdown={currency,displayedTotal:totalAmount,verified:true,nonRoomChargesComplete:true,charges:[{kind:'tax',label:'세금',amount:taxAmount,currency,includedInDisplayedTotal:true},...(local?[{kind:'tax',label:'현지세',amount:localAmount,currency,includedInDisplayedTotal:true}]:[])]};
 const reconciled=roomOnlyFromBreakdown(priceBreakdown,currency);if(!reconciled||Math.abs(reconciled.roomAmount-room)>.005)return null;
 return {roomAmount:room,totalAmount,knownPayableTotal:totalAmount,taxesAndFees:Math.round((taxAmount+localAmount)*100)/100,priceBreakdown,preTaxVerified:true,preTaxAmount:room,amountBasis:'pre-tax',currency};
}
export function comparePreciseFacts(stay,official,offer,now=Date.now()){
 const scope=precisionScope(stay),checks=[];
 function add(key,label,value,reason){checks.push({key,label,state:value===true?'matched':value===false?'mismatched':'unknown',ok:value===true,reason});}
 const o=official?.facts??{},a=offer?.facts??{};
 const trusted=official?.scope===scope&&offer?.scope===scope;
 add('scope','동일 예약 범위',trusted?true:undefined,trusted?'호텔·일정·인원·객실 기준에 연결됨':'다른 예약의 근거는 재사용하지 않음');
 add('fresh','양쪽 요금 최신 확인',freshObservation(official?.capturedAt,now)&&freshObservation(offer?.capturedAt,now)?true:undefined,'관측 시각 기준 24시간 이내');
 const canonical=value=>value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
 function pair(key,label,x,y){add(key,label,!trusted||x==null||y==null?undefined:JSON.stringify(canonical(x))===JSON.stringify(canonical(y)),x==null||y==null?'실제 선택 요금 근거 부족':`공식 ${JSON.stringify(x)} / 타사 ${JSON.stringify(y)}`);}
 add('hotel','동일 호텔',!trusted||!o.hotelId||!a.hotelId?undefined:o.hotelId===stay.id&&a.hotelId===stay.id,'실제 호텔 인식 결과와 감시 호텔이 모두 같아야 함');
 const expectedSearch={checkIn:stay.checkIn,checkOut:stay.checkOut,adults:stay.adults,children:stay.children??0,rooms:stay.rooms??1};
 add('dates','동일 날짜·인원·객실 수',!trusted||!o.search||!a.search?undefined:[o.search,a.search].every(s=>Object.entries(expectedSearch).every(([k,v])=>s[k]===v)),'양쪽 화면에서 요청한 연도·일정·인원·객실 수를 직접 확인');
 // Room mapping is explicit or based on independently observed full descriptors, not bed alone.
 if(o.checkoutRoomMismatch===true)add('room','동일 객실·침대',false,'공식 예약 검토 단계에 다른 객실이 표시됨');else pair('room','동일 객실·침대',o.roomIdentity,a.roomIdentity);
 pair('inclusions','동일 포함 혜택',o.inclusions,a.inclusions);
 pair('cancellation','정확한 무료취소 마감',o.cancellation?.freeUntil,a.cancellation?.freeUntil);
 pair('penalty','취소 후 위약금 규정',o.cancellation?.penalty?.taxesIncluded==null?null:o.cancellation.penalty,a.cancellation?.penalty?.taxesIncluded==null?null:a.cancellation.penalty);
 pair('payment','결제·보증 방식',o.payment,a.payment);
 add('public','공개 접근·제한 없는 타사 요금',a.publicRate===true&&a.restrictionsChecked===true?true:a.publicRate===false?false:undefined,'비로그인 선택 요금과 게스트 결제 진행 근거');
 add('official','공식 동일조건 최저 공개 요금',o.lowestPublicRateVerified===true?true:undefined,'회원요금 포함, 같은 객실·혜택·취소조건끼리 비교');
 add('available','양쪽 실제 예약 가능',o.availabilityVerified===true&&a.availabilityVerified===true?true:undefined,'선택 요금의 미확정 예약 요약 확인');
 const officialRoom=trusted&&o.price?.preTaxVerified===true?o.price.preTaxAmount:null,otaRoom=trusted&&a.price?.preTaxVerified===true?a.price.preTaxAmount:null;
 const sameCurrency=o.price?.currency===stay.booked.currency&&a.price?.currency===stay.booked.currency;
 add('basis','같은 통화 세전 전체 객실료',sameCurrency&&officialRoom>0&&otaRoom>0?true:undefined,'세금·수수료 내역 검산 근거 필요');
 const price=assess(officialRoom,otaRoom,{currency:stay.booked.currency,offerCurrency:a.price?.currency});
 add('margin','공식 세전가보다 1% 초과 저렴',sameCurrency&&officialRoom>0&&otaRoom>0?price.pass:undefined,'환율·추정 세전가로 통과시키지 않음');
 const mismatches=checks.filter(c=>c.state==='mismatched'),unknown=checks.filter(c=>c.state==='unknown');
 return {checks,conditionsVerified:checks.every(c=>c.ok),state:mismatches.length?'mismatch':unknown.length?'partial':'matched',mismatches: mismatches.map(c=>c.key),unknown:unknown.map(c=>c.key),price};
}

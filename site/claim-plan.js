import {reviewBrg,claimWindow,freshObservation} from './brg-readiness.js';
import {policyUrl} from './brg.js';
const DAY=86400000;
const positive=n=>Number.isFinite(n)&&n>0;
const nonnegative=n=>Number.isFinite(n)&&n>=0;
export const roundMoney=(n,currency='EUR')=>Math.round((n+Number.EPSILON)*(currency==='JPY'?1:100))/(currency==='JPY'?1:100);
export const reservationScope=s=>JSON.stringify([s.id,s.checkIn,s.checkOut,s.adults,s.children??0,s.rooms??1,s.booked.currency,s.booked.room,s.booked.total,s.booked.cancellationDeadline]);
export function localInstant(text,zone){
 const m=String(text??'').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);if(!m||!zone)return null;
 const target=Date.UTC(...[+m[1],+m[2]-1,+m[3],+m[4],+m[5]]);
 if(new Date(target).toISOString().slice(0,16)!==`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`)return null;
 let stamp=target;
 try{
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const wall=t=>{const p=Object.fromEntries(formatter.formatToParts(t).map(p=>[p.type,p.value]));return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);};
  for(let i=0;i<3;i++)stamp+=target-wall(stamp);
  return wall(stamp)===target?new Date(stamp).toISOString():null;
 }catch{return null;}
}
export function cancellationCost(stay,now=Date.now()){
 const deadline=localInstant(stay.booked?.cancellationDeadline,stay.timeZone);
 const declared=stay.match?.requireFreeCancellation===true&&/무료취소/.test(stay.booked?.cancellation??'');
 if(declared&&deadline&&Date.parse(deadline)>=now)return {amount:0,known:true,deadline};
 return {amount:null,known:false,deadline};
}
// Never copy OTA taxes to Marriott or assume that old fixed taxes survive a room discount.
// Verified rules must describe Marriott's charges AFTER the selected BRG reward.
export function approvalCost({stay,roomAmount,reward='discount',taxRules,now=Date.now()}){
 if(!positive(roomAmount)||!['discount','points'].includes(reward))return {state:'unknown',room:null,total:null,saving:null};
 const factor=reward==='points'?1:stay.brgDiscountPercent===20?.8:.75;
 const room=roundMoney(roomAmount*factor,stay.booked.currency);
 const cancel=cancellationCost(stay,now);
 const verified=taxRules?.verified===true&&taxRules.currency===stay.booked.currency&&taxRules.scope===reservationScope(stay)&&freshObservation(taxRules.checkedAt,now)&&taxRules.appliesToReward===reward&&nonnegative(taxRules.percent)&&taxRules.percent<=1&&nonnegative(taxRules.fixed)&&Boolean(taxRules.evidence);
 const reference=verified?taxRules:stay.allInEstimate;
 const valid=reference&&nonnegative(reference.percent)&&reference.percent<=1&&nonnegative(reference.fixed);
 const taxes=valid?roundMoney(room*reference.percent+reference.fixed,stay.booked.currency):null;
 const total=taxes===null?null:roundMoney(room+taxes+(cancel.known?cancel.amount:0),stay.booked.currency);
 const saving=positive(stay.booked?.total)&&total!==null?roundMoney(stay.booked.total-total,stay.booked.currency):null;
 const state=!valid?'unknown':verified&&cancel.known?'confirmed-calculation':'estimate';
 return {room,taxes,total,saving,state,cheaper:state==='confirmed-calculation'&&saving>0,cancel,discountPercent:reward==='points'?0:(1-factor)*100,points:reward==='points'?5000:0,taxNote:verified?taxRules.evidence:valid?(reference.note??'미확인 세금 가정'):'Marriott 승인 후 세금·수수료 확인 필요'};
}
function bookingContext(stay,prefs,now){
 const mode=['plan','new','existing'].includes(prefs.mode)?prefs.mode:'plan';
 const checkInTime=/^\d{2}:\d{2}$/.test(prefs.checkInTime??'')?prefs.checkInTime:null;
 const standardCheckInAt=checkInTime?localInstant(`${stay.checkIn} ${checkInTime}`,stay.timeZone):stay.standardCheckInAt;
 const reservedAt=prefs.reservedAt??stay.booked.reservedAt;
 if(mode==='plan'){
  const arrival=standardCheckInAt?Date.parse(standardCheckInAt):null;
  // A future date is enough for exploration, never enough for an application-ready claim.
  const closed=arrival!==null?arrival-now<DAY:Date.parse(`${stay.checkIn}T00:00:00Z`)+DAY<=now+DAY;
  return {mode,stay:{...stay,standardCheckInAt},window:{ok:false,state:closed?'closed':'planned',label:closed?'새 예약도 신청 시간 여유 없음':'새 공식 예약 완료 후 24시간 이내 신청 · 체크인 최소 24시간 전'},reservation:false};
 }
 const confirmed=key=>prefs.bookingConfirmed===true||(mode==='existing'&&stay.booked[key]===true);
 const booked={...stay.booked,reservedAt,directBookingVerified:confirmed('directBookingVerified'),bonvoyLinked:confirmed('bonvoyLinked'),lowestPublicRateVerified:confirmed('lowestPublicRateVerified')};
 const effective={...stay,standardCheckInAt,booked};
 return {mode,stay:effective,window:claimWindow(effective,now),reservation:booked.directBookingVerified===true&&booked.bonvoyLinked===true&&booked.lowestPublicRateVerified===true};
}
export function evaluatePlan(view,prefs={},now=Date.now()){
 const {stay,official,officialOld}=view;const booking=bookingContext(stay,prefs,now);
 const offers=view.sellers.filter(s=>s.price).map(seller=>{
  const review=reviewBrg({stay:booking.stay,...seller,official,officialOld,result:seller.source==='Google 표시가'?view.google?.result:undefined,now});
  const officialAmount=official?.rate.totalAmount;
  const bookingAmountMatched=booking.mode==='plan'||(positive(prefs.reservedRoomAmount)&&Math.abs(prefs.reservedRoomAmount-officialAmount)<.005);
  const checks=review.checks.filter(c=>!['window','reservation'].includes(c.key));
  checks.push({key:'window',label:booking.window.label,ok:booking.window.ok},{key:'reservation',label:booking.mode==='plan'?'현재 공식 최저 동일조건 요금으로 새 예약 필요':'공식 직접 예약·본보이 연결·최저 동일조건 요금 확인',ok:booking.reservation&&bookingAmountMatched});
  const conditions=checks.filter(c=>!['window','reservation'].includes(c.key));
  const conditionsReady=conditions.every(c=>c.ok);
  const cost=approvalCost({stay,roomAmount:review.amount,reward:prefs.reward??'discount',taxRules:official?.rate.approvedTaxRules,now});
  const ready=checks.every(c=>c.ok)&&!review.wrongRoom;
  const rejected=review.wrongRoom||seller.rate?.cancellationPolicyMismatch===true||seller.rate?.inclusionsMismatch===true||seller.rate?.publicRateDisallowed===true;
  const priceFail=!seller.old&&!officialOld&&review.amount!==null&&positive(officialAmount)&&!review.pricePass;
  const worthwhile=ready&&cost.cheaper;
  const state=booking.window.state==='closed'?'closed':rejected||priceFail?'mismatch':worthwhile?'ready':ready&&cost.state==='confirmed-calculation'?'not-cheaper':conditionsReady&&booking.mode==='plan'?'booking-needed':'checking';
  const labels={closed:'신청기한 경과',mismatch:rejected?'요금 조건 불일치':'BRG 가격 차이 미달',ready:'두 조건 충족 · 신청 준비 완료','not-cheaper':'BRG 가능해도 기존 예약 유지 유리','booking-needed':'가격·요금 조건 확인 · 새 공식 예약 필요',checking:review.pricePass||seller.reviewLead?'가격 후보 · 조건 확인 중':'비교 요금 확인 중'};
  const action=state==='ready'?'신청자료 확인':state==='not-cheaper'?'기존 예약 유지':state==='closed'?'신청기한 확인':state==='mismatch'?'불일치 사유 보기':booking.mode==='plan'&&conditionsReady?'새 예약 기준 검토':'가격·조건 확인';
  return {seller,review,checks,conditionsReady,cost,state,label:labels[state],action,ready,worthwhile,priceFail,rejected};
 });
 // Prefer genuinely verified room-only offers over unverified headline prices.
 offers.sort((a,b)=>Number(b.worthwhile)-Number(a.worthwhile)||Number(b.conditionsReady)-Number(a.conditionsReady)||Number(!b.rejected&&b.review.pricePass)-Number(!a.rejected&&a.review.pricePass)||Number(b.review.amount!==null)-Number(a.review.amount!==null)||Number(b.seller.reviewLead)-Number(a.seller.reviewLead)||(a.seller.price.amount-b.seller.price.amount));
 return {stay,mode:booking.mode,window:booking.window,reward:prefs.reward??'discount',offers,best:offers[0]??null};
}
export function safeOfferLink(seller,stay){
 // Only stable property pages from configured sources, never a checkout/session URL.
 const configured=stay.ota?.urls?.[seller?.name];
 try{const u=new URL(configured);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&!/checkout|payment|session|token/i.test(u.pathname)?u.href:null;}catch{return null;}
}
export function claimPacket(plan,offer=plan.best){
 const {stay}=plan,c=stay.booked.currency;
 const lines=[`BRG ${offer?.worthwhile?'신청 준비':'검토 초안 — 미확인 항목 존재 가능'}`,`호텔: ${stay.hotel}`,`일정: ${stay.checkIn} ~ ${stay.checkOut}`,`투숙: 성인 ${stay.adults}, 아동 ${stay.children??0}, 객실 ${stay.rooms??1}`,`객실/침대: ${stay.booked.room}`,`검토 방식: ${plan.mode==='plan'?'현재 공식 요금으로 새 예약 검토 (예약 미실행)':plan.mode==='new'?'새 공식 예약 기준':'기존 예약 기준'}`,`기한: ${plan.window.deadline??plan.window.label}`,`기존 예약 총액: ${stay.booked.total} ${c}`];
 if(offer){
  lines.push(`비교 판매처: ${offer.seller.name}`,`선택 요금 확인시각: ${offer.seller.checkedAt??'미확인'}`,`비교 세전 객실료: ${offer.review.amount??'미확인'} ${c}`,`비교 요금 객실: ${offer.seller.rate?.roomContext??offer.seller.rate?.room??'미확인'}`,`비교 요금 취소조건: ${offer.seller.rate?.cancellationText??'미확인'}`,`내 예약 취소조건: ${stay.booked.cancellationDeadline}`,`보상 선택: ${plan.reward==='points'?'동일요금 매칭 + 5,000 Bonvoy 포인트':'동일요금 매칭 + 객실료 추가 할인'}`,`승인 가정 객실료: ${offer.cost.room??'미확인'} ${c}`,`승인 후 총액: ${offer.cost.total??'미확인'} ${c} (${offer.cost.state==='confirmed-calculation'?'세금 계산 근거 확인, 최종 승인 아님':'세금 미확인/가정'})`,`기존 예약 대비 절감액: ${offer.cost.saving??'미확인'} ${c}`,`양쪽 조건 충족: ${offer.worthwhile?'계산 및 확인항목 충족, 최종 Marriott 심사 필요':'아직 확정 아님'}`);
  const url=safeOfferLink(offer.seller,stay);if(url)lines.push(`판매처 호텔 페이지 (동일 요금 재선택 필요): ${url}`);
  lines.push('확인 항목:',...offer.checks.map(c=>`${c.ok?'확인':'미확인'}: ${c.label}`));
 }
 lines.push(`공식 정책: ${policyUrl}`,'공식 접수: https://brgclaimsubmission.fornova.com/marriott','예약번호/개인정보는 공식 접수창에서 직접 입력. 초안과 스크린샷은 승인 보장이 아님. 기존 예약 자동 취소·신규 예약·신청 제출은 실행하지 않음.');
 return lines.join('\n');
}

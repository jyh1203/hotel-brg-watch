import {assess, candidateEvidence, verifiedPreTaxAmount} from './brg.js';
const DAY=86400000;
const positive=n=>Number.isFinite(n)&&n>0;
// This is a local freshness limit, NOT Marriott's reservation-to-claim deadline.
export function freshObservation(at,now=Date.now()){
 const stamp=Date.parse(at);return Number.isFinite(stamp)&&stamp<=now&&now-stamp<=DAY;
}
// Require an absolute instant: never interpret a hotel's local time as browser time.
function instant(value){return typeof value==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;}
export function claimWindow(stay,now=Date.now()){
 const booked=instant(stay.booked?.reservedAt),arrival=instant(stay.standardCheckInAt);
 if(Number.isFinite(booked)&&(booked>now||now-booked>DAY))return {ok:false,state:'closed',label:'예약 후 24시간 신청 기한 경과 또는 예약 시각 오류'};
 if(Number.isFinite(arrival)&&arrival-now<DAY)return {ok:false,state:'closed',label:'호텔 표준 체크인까지 24시간 미만'};
 if(!Number.isFinite(booked)||!Number.isFinite(arrival))return {ok:false,state:'unknown',label:'예약 시각·호텔 표준 체크인 시각 확인'};
 return {ok:true,state:'open',label:'신청 시간 요건 확인',deadline:new Date(Math.min(booked+DAY,arrival-DAY)).toISOString()};
}
export function reviewBrg({stay,rate,price,checkedAt,old=false,official,officialOld=true,result,now=Date.now()}){
 const observed=rate?.searchEvidence??result?.searchEvidence??rate??{};
 const currency=stay.booked.currency;
 const room=candidateEvidence(stay,{...rate,context:rate?.roomContext??rate?.context});
 const amount=verifiedPreTaxAmount(rate,currency)??(rate?.preTaxVerified===true&&positive(rate?.roomAmount)&&price?.basis==='pre-tax'?price.amount:null);
 const current=official?.rate;
 const currentAmount=current?.amountBasis==='pre-tax'&&current.currency===currency?current.totalAmount:null;
 const priceCheck=assess(currentAmount,amount,{currency,offerCurrency:rate?.currency});
 const window=claimWindow(stay,now);
 const scope=observed.checkIn===stay.checkIn&&observed.checkOut===stay.checkOut&&observed.adults===stay.adults&&observed.children===(stay.children??0)&&observed.rooms===(stay.rooms??1);
 const checks=[
  ['fresh','가격 재조회',!old&&freshObservation(checkedAt,now)],
  ['official','최신 메리어트 동일조건 최저 공개 객실료 확인',!officialOld&&freshObservation(official?.checkedAt,now)&&positive(currentAmount)&&current?.lowestPublicRateVerified===true&&current?.comparable===true],
  ['hotel','동일 호텔 확인',rate?.hotelMatched===true||rate?.hotelVerified===true],
  ['scope','동일 날짜·성인·아동·객실 수 확인',scope],
  ['room','동일 객실·침대 확인',Boolean(stay.match?.roomPatterns?.length)&&Boolean(stay.match?.bedPatterns?.length)&&(rate?.roomIdentityVerified===true||room.roomMatched)],
  ['cancellation','취소 시각·시간대·위약금 확인',rate?.cancellationPolicyMatched===true],
  ['inclusions','조식 등 포함 혜택 확인',rate?.inclusionsMatched===true],
  ['payment','선결제·환불 조건 확인',rate?.paymentPolicyMatched===true],
  ['public','쿠폰·제한 없는 공개 요금 확인',(rate?.publicRate===true||rate?.publicRateVerified===true)&&rate?.restrictionsChecked===true],
  ['available','양쪽 사이트 실제 예약 가능 확인',rate?.availabilityVerified===true&&current?.availabilityVerified===true],
  ['basis','같은 통화의 세금·수수료 제외 전체 객실료 확인',positive(amount)&&positive(currentAmount)],
  ['margin','최신 공식 객실료보다 1% 초과 저렴',priceCheck.pass===true],
  ['window',window.label,window.ok],
  ['reservation','최저 공개 요금 직접 예약·본보이 연결 확인',stay.booked?.directBookingVerified===true&&stay.booked?.bonvoyLinked===true&&stay.booked?.lowestPublicRateVerified===true]
 ].map(([key,label,ok])=>({key,label,ok}));
 const blockers=checks.filter(c=>!c.ok);
 const wrongRoom=room.excludedMatches.length>0;
 const fresh=!old&&freshObservation(checkedAt,now);
 const verified=blockers.length===0;
 let label='BRG 조건 확인 필요';
 if(!fresh)label='재조회 필요';
 else if(wrongRoom)label='객실 조건 불일치';
 else if(current?.precisionTaxVerified===false)label='공식 세전가 정밀 확인 중';
 else if(!positive(amount))label='세전 객실료 확인 필요';
 else if(!officialOld&&positive(currentAmount)&&priceCheck.pass===false)label='BRG 가격 차이 미달';
 else if(verified)label='신청 검토 후보 · Marriott 심사 필요';
 // A cheaper existing reservation is not the reference for a new search opportunity.
 return {label,checks,blockers,verified,pricePass:priceCheck.pass===true,window,wrongRoom,amount};
}

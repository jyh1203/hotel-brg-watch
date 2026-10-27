import test from 'node:test';import assert from 'node:assert/strict';
import {approvalCost,evaluatePlan,localInstant,cancellationCost,reservationScope,claimPacket,safeOfferLink} from '../site/claim-plan.js';
const now=Date.parse('2026-10-27T03:00:00Z'),at='2026-10-27T02:00:00Z';
const stay={id:'example',hotel:'Example',timeZone:'Europe/Paris',checkIn:'2027-04-10',checkOut:'2027-04-12',adults:2,standardCheckInAt:'2027-04-10T15:00:00+02:00',allInEstimate:{percent:.1,fixed:10,note:'미확인 VAT 가정'},booked:{currency:'EUR',roomSubtotal:200,total:220,room:'Standard King',cancellation:'무료취소',cancellationDeadline:'2027-04-09 23:59 (호텔 현지시간)',reservedAt:'2026-08-16T12:00:00Z'},match:{roomPatterns:['standard'],bedPatterns:['king'],excludedPatterns:['twin'],requireFreeCancellation:true}};
const rate={currency:'EUR',totalAmount:240,amountBasis:'pre-tax',roomContext:'Standard King',hotelMatched:true,checkIn:stay.checkIn,checkOut:stay.checkOut,adults:2,children:0,rooms:1,cancellationPolicyMatched:true,inclusionsMatched:true,paymentPolicyMatched:true,publicRate:true,restrictionsChecked:true,availabilityVerified:true};
const taxes={verified:true,currency:'EUR',scope:reservationScope(stay),checkedAt:at,appliesToReward:'discount',percent:.1,fixed:10,evidence:'Marriott room VAT and fixed city tax verified'};
const official={checkedAt:at,rate:{currency:'EUR',amountBasis:'pre-tax',totalAmount:300,lowestPublicRateVerified:true,comparable:true,availabilityVerified:true,approvedTaxRules:taxes}};
const seller={name:'Hotels.com',price:{basis:'pre-tax',amount:240},rate,checkedAt:at,old:false,reviewLead:true};
const view={stay,official,officialOld:false,sellers:[seller]};
const booked={mode:'new',reservedAt:at,reservedRoomAmount:300,bookingConfirmed:true};
test('new-booking exploration uses current 300, not existing 200, and does not reuse old reservation window',()=>{
 const p=evaluatePlan(view,{},now);assert.equal(p.mode,'plan');assert.equal(p.window.state,'planned');assert.equal(p.best.review.pricePass,true);assert.equal(p.best.cost.room,180);assert.equal(p.best.cost.total,208);assert.equal(p.best.cost.saving,12);assert.equal(p.best.worthwhile,false);assert.equal(p.best.state,'booking-needed');
 assert.equal(evaluatePlan(view,{mode:'existing'},now).window.state,'closed');
});
test('both conditions are required: actual booking + verified conditions + all-in saving',()=>{
 const p=evaluatePlan(view,booked,now);assert.equal(p.best.ready,true);assert.equal(p.best.worthwhile,true);assert.equal(p.best.state,'ready');assert.equal(p.window.deadline,'2026-10-28T02:00:00.000Z');
});
test('BRG price pass but approved total above existing total is not worthwhile',()=>{
 const expensive={...view,sellers:[{...seller,rate:{...rate,totalAmount:295},price:{basis:'pre-tax',amount:295}}]};
 const r=evaluatePlan(expensive,booked,now).best;assert.equal(r.review.pricePass,true);assert.equal(r.ready,true);assert.equal(r.worthwhile,false);assert.equal(r.state,'not-cheaper');assert.ok(r.cost.saving<0);
});
test('same total is not cheaper and cancellation charges cannot silently be zero',()=>{
 const s={...stay,booked:{...stay.booked,total:208}};
 const cost=approvalCost({stay:s,roomAmount:240,taxRules:{...taxes,scope:reservationScope(s)},now});assert.equal(cost.saving,0);assert.equal(cost.cheaper,false);
 const expired={...stay,booked:{...stay.booked,cancellationDeadline:'2026-10-26 23:59'}};
 assert.equal(cancellationCost(expired,now).known,false);
 const result=approvalCost({stay:expired,roomAmount:240,taxRules:{...taxes,scope:reservationScope(expired)},now});assert.equal(result.state,'estimate');assert.equal(result.cheaper,false);
});
test('unknown or estimated taxes never satisfy all-in saving gate even with positive estimate',()=>{
 for(const patch of [{approvedTaxRules:null},{approvedTaxRules:{...taxes,verified:false}},{approvedTaxRules:{...taxes,currency:'USD'}},{approvedTaxRules:{...taxes,scope:'other'}},{approvedTaxRules:{...taxes,checkedAt:'2026-10-25T02:00:00Z'}},{approvedTaxRules:{...taxes,appliesToReward:'points'}}]){
  const p=evaluatePlan({...view,official:{...official,rate:{...official.rate,...patch}}},booked,now);assert.equal(p.best.ready,true);assert.equal(p.best.cost.state,'estimate');assert.equal(p.best.worthwhile,false);
 }
 const none=approvalCost({stay:{...stay,allInEstimate:null},roomAmount:240,now});assert.equal(none.total,null);assert.equal(none.saving,null);
});
test('points option does not apply 25 percent or cash value and taxes must match reward',()=>{
 const cost=approvalCost({stay,roomAmount:240,reward:'points',taxRules:{...taxes,appliesToReward:'points'},now});assert.equal(cost.room,240);assert.equal(cost.total,274);assert.equal(cost.points,5000);assert.equal(cost.cheaper,false);
 assert.equal(approvalCost({stay:{...stay,brgDiscountPercent:20},roomAmount:240,now}).room,192);
});
test('exact 1 percent, wrong currency, unverified tax basis and wrong bed never qualify',()=>{
 for(const patch of [{totalAmount:297},{currency:'USD'},{amountBasis:'unknown'},{roomContext:'Standard Twin'}]){
  const r=evaluatePlan({...view,sellers:[{...seller,rate:{...rate,...patch}}]},booked,now).best;assert.equal(r.worthwhile,false);
 }
});
test('new actual booking must match current official rate, not inherited historical amount',()=>{
 for(const reservedRoomAmount of [undefined,null,200,NaN])assert.equal(evaluatePlan(view,{...booked,reservedRoomAmount},now).best.ready,false);
});
test('expired, missing, future or unzoned actual booking never becomes ready; collection time does not restart clock',()=>{
 for(const reservedAt of [undefined,'2026-10-25T02:00:00Z','2026-10-28T02:00:00Z','2026-10-27 02:00']){
  assert.equal(evaluatePlan(view,{...booked,reservedAt},now).best.worthwhile,false);
 }
 assert.equal(evaluatePlan({...view,stay:{...stay,standardCheckInAt:null}},booked,now).window.state,'unknown');
 assert.equal(evaluatePlan({...view,stay:{...stay,standardCheckInAt:'2026-10-28T02:59:59Z'}},{},now).window.state,'closed');
});
test('new booking confirmation cannot inherit old reservation direct/member verification',()=>{
 const v={...view,stay:{...stay,booked:{...stay.booked,directBookingVerified:true,bonvoyLinked:true,lowestPublicRateVerified:true}}};
 assert.equal(evaluatePlan(v,{...booked,bookingConfirmed:false},now).best.ready,false);
});
test('all scope/offer/restriction/freshness checks remain in force',()=>{
 for(const patch of [{children:null},{rooms:2},{inclusionsMatched:false},{cancellationPolicyMatched:false},{publicRate:false},{restrictionsChecked:false},{availabilityVerified:false}])assert.equal(evaluatePlan({...view,sellers:[{...seller,rate:{...rate,...patch}}]},booked,now).best.ready,false);
 assert.equal(evaluatePlan({...view,officialOld:true},booked,now).best.ready,false);
 assert.equal(evaluatePlan({...view,sellers:[{...seller,old:true}]},booked,now).best.ready,false);
});
test('verified room offer ranks above a cheaper headline; selected data remain offer scoped',()=>{
 const cheap={...seller,name:'Google headline',price:{basis:'unknown',amount:100},rate:{currency:'EUR',totalAmount:100,amountBasis:'unknown'}};
 assert.equal(evaluatePlan({...view,sellers:[cheap,seller]},booked,now).best.seller.name,'Hotels.com');
});
test('hotel local cancellation uses DST and not browser time; missing or invalid timezone remains unknown',()=>{
 assert.equal(localInstant('2027-04-09 23:59','Europe/Paris'),'2027-04-09T21:59:00.000Z');
 assert.equal(localInstant('2027-01-09 23:59','Europe/Madrid'),'2027-01-09T22:59:00.000Z');
 assert.equal(localInstant('2027-03-28 02:30','Europe/Paris'),null);
 assert.equal(localInstant('2027-04-09 23:59','Invalid'),null);
 assert.equal(cancellationCost({...stay,timeZone:null},now).known,false);
});
test('packet preserves missing conditions, reward and deadlines; stable property URLs only',()=>{
 const p=evaluatePlan(view,{},now),text=claimPacket(p);assert.match(text,/検討|검토 초안/);assert.match(text,/미확인: 현재 공식 최저/);assert.match(text,/예약 미실행/);assert.match(text,/208 EUR/);assert.doesNotMatch(text,/신청 준비\n/);
 assert.equal(safeOfferLink(seller,{...stay,ota:{urls:{'Hotels.com':'https://example.com/checkout?token=secret'}}}),null);
 assert.equal(safeOfferLink(seller,{...stay,ota:{urls:{'Hotels.com':'javascript:alert(1)'}}}),null);
});

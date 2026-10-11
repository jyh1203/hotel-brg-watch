import test from 'node:test';import assert from 'node:assert/strict';
import {freshObservation,claimWindow,reviewBrg} from '../site/brg-readiness.js';
import {candidateEvidence} from '../site/brg.js';
const now=Date.parse('2026-10-11T12:00:00Z'),at='2026-10-11T11:00:00Z';
const stay={checkIn:'2027-04-03',checkOut:'2027-04-07',adults:2,standardCheckInAt:'2027-04-03T15:00:00+02:00',match:{roomPatterns:['standard'],bedPatterns:['king'],excludedPatterns:['twin'],requireFreeCancellation:true},booked:{currency:'EUR',roomSubtotal:80,reservedAt:at,directBookingVerified:true,bonvoyLinked:true,lowestPublicRateVerified:true,cancellationDeadline:'2027-04-02 23:59'}};
const rate={currency:'EUR',totalAmount:90,amountBasis:'pre-tax',roomContext:'Standard King',hotelMatched:true,checkIn:stay.checkIn,checkOut:stay.checkOut,adults:2,children:0,rooms:1,cancellationPolicyMatched:true,inclusionsMatched:true,paymentPolicyMatched:true,publicRate:true,restrictionsChecked:true,availabilityVerified:true};
const official={checkedAt:at,rate:{currency:'EUR',amountBasis:'pre-tax',totalAmount:100,lowestPublicRateVerified:true,comparable:true,availabilityVerified:true}};
const args={stay,rate,price:{basis:'pre-tax',amount:90},checkedAt:at,official,officialOld:false,now};
test('complete evidence can become a review candidate using current official price, never old booking price',()=>{
 const r=reviewBrg(args);assert.equal(r.verified,true);assert.equal(r.pricePass,true);assert.match(r.label,/심사 필요/);
});
test('unknown hotel, benefits, penalties, payment, public restrictions and booking availability never qualify',()=>{
 for(const key of ['hotelMatched','inclusionsMatched','cancellationPolicyMatched','paymentPolicyMatched','restrictionsChecked','availabilityVerified']){
 const copy={...rate};delete copy[key];assert.equal(reviewBrg({...args,rate:copy}).verified,false,key);
 }
 assert.equal(reviewBrg({...args,rate:{...rate,children:null}}).verified,false);
 assert.equal(reviewBrg({...args,official:{...official,rate:{...official.rate,comparable:false}}}).verified,false);
});
test('freshness rejects invalid future missing and expired timestamps, failed refresh stays blocked',()=>{
 for(const at of [undefined,'invalid','2026-10-12T12:00:00Z','2026-10-10T11:59:59Z'])assert.equal(freshObservation(at,now),false);
 assert.equal(reviewBrg({...args,old:true}).verified,false);assert.equal(reviewBrg({...args,officialOld:true}).verified,false);
});
test('claim timing uses reservation time not collection time and requires timezone',()=>{
 assert.equal(claimWindow({...stay,booked:{...stay.booked,reservedAt:undefined}},now).state,'unknown');
 assert.equal(claimWindow({...stay,booked:{...stay.booked,reservedAt:'2026-10-09T12:00:00Z'}},now).state,'closed');
 assert.equal(claimWindow({...stay,standardCheckInAt:'2026-10-12T11:59:59Z'},now).state,'closed');
 assert.equal(claimWindow({...stay,standardCheckInAt:'2026-10-12T12:00:00Z'},now).state,'open');
 assert.equal(claimWindow({...stay,booked:{...stay.booked,reservedAt:'2026-10-11 11:00'}},now).state,'unknown');
});
test('day-only cancellation is not matching exact local deadline and penalty policy',()=>{
 assert.equal(candidateEvidence(stay,{context:'Standard King',freeCancellation:true,cancellationDeadline:'2027-04-02'}).cancellationPolicyMatched,false);
 assert.equal(candidateEvidence({match:{}},{context:''}).roomMatched,false);
});
test('tax-inclusive, wrong currency, wrong room, or exactly 1% difference never become verified',()=>{
 for(const patch of [{amountBasis:'tax-included'},{currency:'USD'},{roomContext:'Standard Twin'},{totalAmount:99}])assert.equal(reviewBrg({...args,rate:{...rate,...patch}}).verified,false);
});

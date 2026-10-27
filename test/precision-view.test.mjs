import {evaluatePlan} from '../site/claim-plan.js';
import test from 'node:test';import assert from 'node:assert/strict';import {hotelView} from '../site/rate-display.js';import {precisionFor} from '../site/precision-view.js';import {sourceFactRows} from '../site/precision-ui.js';import {precisionScope,comparePreciseFacts} from '../src/brg-precision.mjs';
const now=Date.parse('2026-10-27T06:00:00Z'),at='2026-10-27T05:50:00Z';
const stay={id:'bordeaux',hotel:'Moxy Bordeaux',timeZone:'Europe/Paris',checkIn:'2027-04-10',checkOut:'2027-04-12',adults:2,marriott:{},match:{roomPatterns:['moxy sleeper'],bedPatterns:['queen'],requireFreeCancellation:true},booked:{currency:'EUR',roomSubtotal:269,total:278.8,room:'Moxy Sleeper, 1 Queen',cancellationDeadline:'2027-04-09 23:59'}};
const facts={hotelId:stay.id,search:{checkIn:stay.checkIn,checkOut:stay.checkOut,adults:2,children:0,rooms:1},roomIdentity:stay.booked.room,cancellation:{freeUntil:'2027-04-09T21:59:00.000Z',penalty:{kind:'first-night',taxesIncluded:true}},payment:{timing:'property',guarantee:'card'},inclusions:{breakfast:false},publicRate:true,restrictionsChecked:true,availabilityVerified:true,lowestPublicRateVerified:true,price:{currency:'EUR',preTaxVerified:true,preTaxAmount:269,taxesAndFees:9.8,totalAmount:278.8}};
const rate={status:'ok',currency:'EUR',totalAmount:269,amountBasis:'pre-tax',prepaid:false,checkIn:stay.checkIn,checkOut:stay.checkOut,adults:2,capturedAt:at};
function data(officialFacts=facts,offerFacts={...facts,price:{...facts.price,preTaxAmount:252.72,totalAmount:287.8,taxesAndFees:35.08}}){
 const official={provider:'Marriott',scope:precisionScope(stay),capturedAt:at,facts:officialFacts,rate};const offer={provider:'Hotels.com',scope:precisionScope(stay),capturedAt:at,status:'pending',state:'selected-offer-observed',facts:offerFacts,evidence:{roomText:'룸, 퀸사이즈침대 1개'}};
 const verification={schemaVersion:1,scope:precisionScope(stay),capturedAt:at,official,offers:[offer],comparisons:[{provider:'Hotels.com',...comparePreciseFacts(stay,official,offer,now)}]};
 return {runs:[],collectorStatus:{results:[{id:stay.id,status:'ok',verification}]}};
}
test('precise source values feed the dashboard without requiring Google history or legacy OTA attempts',()=>{
 const v=hotelView(data(),stay,now),s=v.sellers.find(s=>s.name==='Hotels.com');assert.equal(v.official.rate.totalAmount,269);assert.equal(s.price.amount,252.72);assert.equal(s.rate.roomIdentityVerified,true);assert.equal(s.rate.cancellationPolicyMatched,true);assert.equal(s.rate.publicRate,true);assert.equal(s.brg.pricePass,true);assert.equal(s.brg.verified,false);assert.equal(v.precision.fresh,true);
});
test('unverified official tax basis stays unknown, cannot satisfy BRG or official-drop comparisons',()=>{
 const v=hotelView(data({...facts,price:null}),stay,now),s=v.sellers.find(s=>s.name==='Hotels.com');assert.equal(v.official.rate.amountBasis,'unknown');assert.equal(v.difference,null);assert.equal(v.officialLower,false);assert.equal(s.brg.pricePass,false);assert.equal(s.brg.verified,false);assert.match(s.brg.label,/공식 세전가/);
});
test('unknown room mapping does not become a named Marriott match merely because Queen is visible',()=>{
 const v=hotelView(data(facts,{...facts,roomIdentity:null}),stay,now),s=v.sellers.find(s=>s.name==='Hotels.com');assert.equal(s.rate.roomIdentityVerified,false);assert.equal(s.brg.checks.find(c=>c.key==='room').ok,false);
});
test('different scope drops verification entirely; stale comparisons cannot be reused as fresh matches',()=>{
 const d=data();assert.equal(precisionFor(d,{...stay,booked:{...stay.booked,total:100}},now),null);
 const v=hotelView(d,stay,now+86400001),s=v.sellers.find(s=>s.name==='Hotels.com');assert.equal(v.precision.fresh,false);assert.equal(s.old,true);assert.equal(s.rate.cancellationPolicyMatched,false);assert.equal(s.rate.roomIdentityVerified,false);
});
test('UI evidence separates source confirmations from matching conditions and shows hotel local cancel time',()=>{
 const rows=sourceFactRows({provider:'Hotels.com',facts:{...facts,roomIdentity:null}},stay);assert.equal(rows.find(r=>r.key==='room').ok,false);assert.match(rows.find(r=>r.key==='cancellation').value,/Europe\/Paris/);assert.match(rows.find(r=>r.key==='cancellation').value,/한국시간/);
});

test('a known cancellation mismatch is excluded from low-price leads rather than advertised as a candidate',()=>{
 const original={...facts,price:{...facts.price,preTaxAmount:252.72,totalAmount:287.8,taxesAndFees:35.08},cancellation:{...facts.cancellation,freeUntil:'2027-04-09T16:00:00.000Z'}};
 const view=hotelView(data(facts,original),stay,now),seller=view.sellers.find(s=>s.name==='Hotels.com');assert.equal(seller.rate.cancellationPolicyMismatch,true);assert.equal(seller.reviewLead,false);assert.equal(seller.lower,false);
});

test('an unverified official tax basis is pending, not a failed BRG margin or a guessed all-in saving',()=>{
 const view=hotelView(data({...facts,price:null}),stay,now),plan=evaluatePlan(view,{},now);assert.equal(plan.best.priceFail,false);assert.equal(plan.best.state,'checking');assert.equal(plan.best.cost.total,null);assert.equal(plan.best.cost.saving,null);
});

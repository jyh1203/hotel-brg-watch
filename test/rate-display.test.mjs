import test from 'node:test';import assert from 'node:assert/strict';
import {displayPrice,hotelView,stayScope,normalizeGoogleRate} from '../site/rate-display.js';
const stay={id:'hotel',hotel:'Test',checkIn:'2027-04-03',checkOut:'2027-04-07',adults:2,booked:{currency:'EUR',room:'Standard King',roomSubtotal:666.9,total:733.6,cancellationDeadline:'2027-04-02'}};
test('simple price shows known pretax and actual tax, falls back to all-in without inventing tax',()=>{
 assert.deepEqual(displayPrice({currency:'EUR',roomAmount:702,preTaxVerified:true,totalAmount:772.2,taxesAndFees:70.2,amountBasis:'tax-included'},'EUR'),{amount:702,basis:'pre-tax',total:772.2,taxes:70.2});
 assert.deepEqual(displayPrice({currency:'EUR',totalAmount:858,amountBasis:'tax-included'},'EUR'),{amount:858,basis:'tax-included',total:858,taxes:null});
 assert.equal(displayPrice({currency:'EUR',totalAmount:760,amountBasis:'pre-tax'},'EUR').amount,760);
 assert.equal(displayPrice({currency:'EUR',totalAmount:600},'EUR').basis,'unknown');
 assert.equal(displayPrice({currency:'KRW',totalAmount:100000},'EUR'),null);
});
test('direct checkout wins over Google, stays scoped, and remains visibly old on fresh failure',()=>{
 const capturedAt=new Date().toISOString();const data={runs:[{capturedAt,results:[{id:'hotel',status:'ok',providers:[{provider:'Expedia',currency:'EUR',totalAmount:600,amountBasis:'tax-included'}],marriott:{status:'ok',prepaid:false,currency:'EUR',totalAmount:650,amountBasis:'pre-tax',checkIn:stay.checkIn,checkOut:stay.checkOut,adults:2}}]}],otaStatus:{results:[{id:'hotel',providers:[{provider:'Expedia',scope:stayScope(stay),status:'error',state:'blocked',capturedAt,checkoutObservation:{capturedAt,currency:'EUR',totalAmount:858,amountBasis:'tax-included'}}]}]}};
 const view=hotelView(data,stay);const row=view.sellers.find(x=>x.name==='Expedia');assert.equal(row.price.amount,858);assert.equal(row.old,true);assert.equal(row.lower,false);assert.equal(view.officialLower,true);assert.equal(view.difference,16.9);
 data.otaStatus.results[0].providers[0].scope='old dates';assert.equal(hotelView(data,stay).sellers.find(x=>x.name==='Expedia').price.amount,600);
 data.runs[0].results[0].marriott.checkIn='2027-04-02';assert.equal(hotelView(data,stay).official,undefined);
});
test('expired or failed official observations remain visible but never count as a current rate drop',()=>{
 const now=Date.parse('2026-10-11T12:00:00Z');
 const m={status:'ok',prepaid:false,currency:'EUR',totalAmount:600,amountBasis:'pre-tax',checkIn:stay.checkIn,checkOut:stay.checkOut,adults:2};
 for(const capturedAt of ['2026-10-09T12:00:00Z','invalid','2026-10-12T12:00:00Z']){
  const view=hotelView({runs:[{capturedAt,results:[{id:stay.id,marriott:m}]}]},stay,now);
  assert.equal(view.official.rate.totalAmount,600);assert.equal(view.officialLower,false);assert.equal(view.officialOld,true);
 }
});
test('newer successful source beats older checkout; unknown search conditions never raise low-price alert',()=>{
 const now=Date.parse('2026-10-11T12:00:00Z'),capturedAt='2026-10-11T11:00:00Z';
 const rate={currency:'EUR',totalAmount:600,amountBasis:'tax-included'};
 const data={runs:[{capturedAt,results:[{id:stay.id,status:'ok',providers:[{provider:'Expedia',...rate}]}]}]};
 assert.equal(hotelView(data,stay,now).cheaper,false);
 data.otaStatus={results:[{id:stay.id,providers:[{provider:'Expedia',scope:stayScope(stay),status:'ok',capturedAt,...rate,checkoutObservation:{...rate,totalAmount:858,capturedAt:'2026-10-11T10:00:00Z'}}]}]};
 assert.equal(hotelView(data,stay,now).sellers.find(s=>s.name==='Expedia').price.amount,600);
});

const scopedStay={...stay,match:{roomPatterns:['standard'],bedPatterns:['king'],excludedPatterns:['twin'],requireFreeCancellation:true}};
function snapshot({amount=600,capturedAt='2026-10-27T01:00:00Z',failed=false}={}){
 const searchEvidence={checkIn:stay.checkIn,checkOut:stay.checkOut,adults:2,children:0,rooms:1};
 return {runs:[{capturedAt,results:[{id:stay.id,status:'ok',searchEvidence,providers:[{provider:'Booking.com',currency:'EUR',totalAmount:amount,amountBasis:'tax-included',displayMode:'stay-total',estimatedFromNightly:false}],marriott:{status:'ok',prepaid:false,currency:'EUR',totalAmount:650,amountBasis:'pre-tax',checkIn:stay.checkIn,checkOut:stay.checkOut,adults:2,capturedAt}}]}],googleStatus:{results:[{id:stay.id,status:failed?'error':'ok',capturedAt:'2026-10-27T01:30:00Z'}]}};
}
test('legacy global Google tax flags cannot certify seller totals',()=>{
 const original={currency:'EUR',totalAmount:600,amountBasis:'tax-included'};
 const r=normalizeGoogleRate(original);assert.equal(r.amountBasis,'unknown');assert.equal(displayPrice(r,'EUR').basis,'unknown');
 assert.equal(original.amountBasis,'tax-included');
 assert.equal(normalizeGoogleRate({...original,taxBasisVerified:true,taxEvidence:'Selected seller explicitly includes taxes'}).amountBasis,'tax-included');
});
test('latest Google observation replaces old checkout without carrying its failure',()=>{
 const d=snapshot();d.otaStatus={results:[{id:stay.id,providers:[{provider:'Booking.com',scope:stayScope(stay),status:'error',capturedAt:'2026-10-11T00:00:00Z',checkoutObservation:{currency:'EUR',totalAmount:800,amountBasis:'tax-included',capturedAt:'2026-10-11T00:00:00Z'}}]}]};
 const s=hotelView(d,scopedStay,Date.parse('2026-10-27T02:00:00Z')).sellers[0];
 assert.equal(s.price.amount,600);assert.equal(s.source,'Google 표시가');assert.equal(s.old,false);assert.equal(s.refreshFailed,false);
});
test('failed refresh remains distinct from observation age and does not erase a review lead',()=>{
 const s=hotelView(snapshot({failed:true}),scopedStay,Date.parse('2026-10-27T02:00:00Z')).sellers[0];
 assert.equal(s.ageExpired,false);assert.equal(s.refreshFailed,true);assert.equal(s.old,true);
 assert.equal(s.reviewLead,true);assert.equal(s.lower,false);assert.equal(s.screen.eligible,false);assert.equal(s.brg.verified,false);
});
test('below official pretax is a visible review lead even with tax unknown but never eligibility',()=>{
 const v=hotelView(snapshot(),scopedStay,Date.parse('2026-10-27T02:00:00Z'));const s=v.sellers[0];
 assert.equal(v.reviewLeads,1);assert.equal(s.price.basis,'unknown');assert.equal(s.screen.priceMargin,true);assert.equal(s.screen.difference,50);
 assert.equal(s.screen.eligible,false);assert.equal(s.brg.verified,false);
});
test('known wrong room and unknown occupancy cannot become review leads',()=>{
 const d=snapshot();d.runs[0].results[0].providers[0].context='Standard Twin';assert.equal(hotelView(d,scopedStay).reviewLeads,0);
 delete d.runs[0].results[0].providers[0].context;delete d.runs[0].results[0].searchEvidence;assert.equal(hotelView(d,scopedStay).reviewLeads,0);
});
test('above current official but below original booking is not a BRG low-price lead',()=>{
 const v=hotelView(snapshot({amount:700}),scopedStay,Date.parse('2026-10-27T02:00:00Z'));assert.equal(v.reviewLeads,0);assert.equal(v.cheaper,false);
});

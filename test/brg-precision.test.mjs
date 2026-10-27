import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {parseExactCancellation,parseHotelsPrice,comparePreciseFacts,precisionScope} from '../src/brg-precision.mjs';
const actual=JSON.parse(fs.readFileSync(new URL('./fixtures/precision/hotels-bordeaux-observed.json',import.meta.url)));
const now=Date.parse('2026-10-27T05:00:00Z');
const stay={id:'bordeaux',checkIn:'2027-04-10',checkOut:'2027-04-12',adults:2,timeZone:'Europe/Paris',booked:{currency:'EUR',room:'Moxy Sleeper, 1 Queen',total:278.80,cancellationDeadline:'2027-04-09 23:59'}};
const facts={hotelId:stay.id,search:{checkIn:stay.checkIn,checkOut:stay.checkOut,adults:2,children:0,rooms:1},roomIdentity:stay.booked.room,inclusions:{breakfast:false},cancellation:{freeUntil:'2027-04-09T21:59:00.000Z',penalty:{kind:'first-night',taxesIncluded:true}},payment:{timing:'property',guarantee:'card'},publicRate:true,restrictionsChecked:true,lowestPublicRateVerified:true,availabilityVerified:true,price:{currency:'EUR',preTaxVerified:true,preTaxAmount:269}};
const official={scope:precisionScope(stay),capturedAt:'2026-10-27T04:30:00Z',facts};
const offer={...official,provider:'Hotels.com',facts:{...structuredClone(facts),price:{...facts.price,preTaxAmount:252.72}}};
test('live Hotels.com scoped price panel reconciles all taxes and excludes pay-today zero',()=>{
 const r=parseHotelsPrice(actual.priceText);assert.equal(r.roomAmount,252.72);assert.equal(r.totalAmount,287.8);assert.equal(r.taxesAndFees,35.08);assert.equal(r.preTaxVerified,true);
 for(const text of [actual.priceText.replace('€25.28','€25.29'),actual.priceText.replace('현지세€9.80',''),actual.priceText+'수수료 €3',actual.priceText+'쿠폰 적용']){
  if(text!==actual.priceText)assert.equal(parseHotelsPrice(text),null);
 }
 assert.equal(parseHotelsPrice(actual.priceText,'USD'),null);
});
test('live cancellation policy resolves exact hotel-local deadline and first-night taxes penalty',()=>{
 const r=parseExactCancellation(actual.cancellationText,{year:2027,timeZone:'Europe/Paris',datesVerified:true});assert.equal(r.freeUntil,'2027-04-09T21:59:00.000Z');assert.deepEqual(r.penalty,{kind:'first-night',taxesIncluded:true});assert.equal(r.verified,true);
 for(const opts of [{year:2027,timeZone:'Europe/Paris',datesVerified:false},{year:2027,timeZone:null,datesVerified:true}])assert.equal(parseExactCancellation(actual.cancellationText,opts).verified,false);
 assert.equal(parseExactCancellation('4월 9일 전 전액 환불 가능',{year:2027,timeZone:'Europe/Paris',datesVerified:true}).verified,false);
});
test('matching source facts can verify price and terms, never an actual reservation window',()=>{
 const r=comparePreciseFacts(stay,official,offer,now);assert.equal(r.state,'matched');assert.equal(r.conditionsVerified,true);assert.equal(r.price.pass,true);assert.ok(!r.checks.some(c=>c.key==='window'));
});
test('both sites agreeing on wrong dates or hotel is not a match to the requested reservation',()=>{
 for(const patch of [{hotelId:'different-hotel'},{search:{...facts.search,checkIn:'2027-04-11'}}]){
  const r=comparePreciseFacts(stay,{...official,facts:{...facts,...patch}},{...offer,facts:{...offer.facts,...patch}},now);assert.equal(r.state,'mismatch');assert.equal(r.conditionsVerified,false);
 }
});
test('missing child count, room identity or exact penalty remains unknown; different deadlines fail',()=>{
 for(const patch of [{search:null},{roomIdentity:null},{cancellation:{...facts.cancellation,penalty:{kind:'first-night',taxesIncluded:null}}}]){
  const r=comparePreciseFacts(stay,official,{...offer,facts:{...offer.facts,...patch}},now);assert.equal(r.state,'partial');assert.equal(r.conditionsVerified,false);
 }
 const r=comparePreciseFacts(stay,official,{...offer,facts:{...offer.facts,cancellation:{...facts.cancellation,freeUntil:'2027-04-08T21:59:00.000Z'}}},now);assert.equal(r.state,'mismatch');assert.ok(r.mismatches.includes('cancellation'));
});
test('object property order does not create false cancellation/payment mismatches',()=>{
 const r=comparePreciseFacts(stay,official,{...offer,facts:{...offer.facts,payment:{guarantee:'card',timing:'property'},cancellation:{...facts.cancellation,penalty:{taxesIncluded:true,kind:'first-night'}}}},now);assert.equal(r.state,'matched');
});
test('stale, different reservation scope, unverified official pretax or public restrictions cannot pass',()=>{
 for(const patch of [{capturedAt:'2026-10-25T05:00:00Z'},{scope:'other'},{facts:{...offer.facts,publicRate:false}},{facts:{...offer.facts,price:{...offer.facts.price,currency:'USD'}}}])assert.equal(comparePreciseFacts(stay,official,{...offer,...patch},now).conditionsVerified,false);
 assert.equal(comparePreciseFacts(stay,{...official,facts:{...facts,price:{...facts.price,preTaxVerified:false}}},offer,now).conditionsVerified,false);
});

test('explicit Marriott cancellation fee is retained without inventing a first-night tax rule',()=>{
 const text='You may cancel your reservation for no charge before 11:59 PM local hotel time on April 9, 2027. Please note that we will assess a fee of 127.90 EUR if you must cancel after this deadline.';
 const r=parseExactCancellation(text,{year:2027,timeZone:'Europe/Paris',datesVerified:true});assert.equal(r.freeUntil,'2027-04-09T21:59:00.000Z');assert.deepEqual(r.penalty,{kind:'fixed-amount',amount:127.9,currency:'EUR',taxesIncluded:null});
 const result=comparePreciseFacts(stay,{...official,facts:{...facts,cancellation:r}},offer,now);assert.equal(result.checks.find(c=>c.key==='penalty').state,'unknown');
});

test('an aggregate tax-only price panel can reconcile without inventing a separate city tax',()=>{
 const r=parseHotelsPrice('3박 €150.61/1박 €451.82 세금 €45.17 총 금액 €496.99 오늘 결제 €0.00 숙박 시설에서 결제 €496.99');assert.equal(r.preTaxAmount,451.82);assert.equal(r.taxesAndFees,45.17);assert.equal(r.priceBreakdown.charges.length,1);
 assert.equal(parseHotelsPrice('3박 €150.61/1박 €451.82 세금 €45.17 총 금액 €496.99 현지 세금 별도'),null);
});

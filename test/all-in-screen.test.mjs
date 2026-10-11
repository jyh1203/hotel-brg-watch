import test from 'node:test';
import assert from 'node:assert/strict';
import {screenAllInOffer,providerName} from '../site/brg.js';
import {parseGoogleHotelPrices} from '../src/parse-google-hotels.mjs';
const stay={checkIn:'2027-04-03',checkOut:'2027-04-07',adults:2,booked:{currency:'EUR',roomSubtotal:200}};
const result={dateConfirmed:true,occupancyConfirmed:true,nights:4,searchEvidence:{checkIn:stay.checkIn,checkOut:stay.checkOut,adults:2,children:0}};
const candidate={provider:'Expedia',currency:'EUR',totalAmount:190,amountBasis:'tax-included',estimatedFromNightly:false,publicRate:true};
const official={currency:'EUR',totalAmount:210,amountBasis:'pre-tax'};
test('all-in total lower than room-only price is screening only',()=>{
 const screen=screenAllInOffer({stay,result,candidate,official});
 assert.equal(screen.priority,true);assert.equal(screen.belowBooked,true);assert.equal(screen.belowOfficial,true);
 assert.equal(screen.bookedPriceMargin,true);assert.equal(screen.eligible,false);assert.equal(screen.verified,false);assert.equal(screen.comparisonAmount,null);
});
test('screening rejects stale, guessed totals, private rates and unobserved conditions',()=>{
 for(const args of [{stale:true},{result:{...result,occupancyConfirmed:false}},{result:{...result,searchEvidence:{...result.searchEvidence,checkOut:'2027-04-08'}}},{candidate:{...candidate,currency:'USD'}},{candidate:{...candidate,estimatedFromNightly:true}},{candidate:{...candidate,official:true}},{candidate:{...candidate,publicRate:false}},{candidate:{...candidate,totalAmount:NaN}}]){
  assert.equal(screenAllInOffer({stay,result,candidate,official,...args}).priority,false);
 }
});
test('below official but above booked does not imply booked BRG margin',()=>{
 const screen=screenAllInOffer({stay,result,candidate:{...candidate,totalAmount:205},official});
 assert.equal(screen.priority,true);assert.equal(screen.belowBooked,false);assert.equal(screen.bookedPriceMargin,false);
 assert.equal(screenAllInOffer({stay,result,candidate:{...candidate,totalAmount:205},official,officialStale:true}).priority,false);
});
test('all three OTA names are normalized without accepting unrelated sites',()=>{
 for(const name of ['Booking.com','Agoda','Expedia'])assert.equal(providerName(name),name);
 assert.equal(providerName('익스피디아'),'Expedia');assert.equal(providerName('not-expedia.com'),null);
});
test('provider heading with cancellation prose must not inherit the previous seller',()=>{
 const text='Sponsored·Featured options\nHotels.com\n€772\nVisit site\nStandard Room, 1 King Bed\nFree cancellation until Apr 2\n€772\nVisit site\nAgoda\nFree cancellation until Apr 2\nFree Wi-Fi\n€772\nVisit site\nBooking.com\nFree cancellation until Apr 2\n€773\nVisit site\nExpedia.co.kr\nFree cancellation until Apr 2\n€774\nVisit site\nAll options\nTrack this hotel';
 const parsed=parseGoogleHotelPrices(text,stay,'EUR',{mode:'stay-total',amountBasis:'tax-included'});
 assert.deepEqual(parsed.roomRates.map(x=>x.provider),['Hotels.com','Hotels.com','Agoda','Booking.com','Expedia.co.kr']);
 assert.equal(providerName('Expedia.co.kr'),'Expedia');
});

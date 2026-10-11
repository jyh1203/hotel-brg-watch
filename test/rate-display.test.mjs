import test from 'node:test';import assert from 'node:assert/strict';
import {displayPrice,hotelView,stayScope} from '../site/rate-display.js';
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

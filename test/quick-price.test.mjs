import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePriceInput,quickPriceComparison} from '../site/quick-price.js';
const stay={checkIn:'2027-04-03',checkOut:'2027-04-07',booked:{currency:'EUR',total:733.6,roomSubtotal:666.9}};
const compare=(total,fees=null,currency='EUR')=>quickPriceComparison({stay,total,includedFees:fees,currency});
test('total alone gives all-in difference without inventing pretax or eligibility',()=>{
 const r=compare(700);assert.equal(r.difference,33.6);assert.equal(r.averageNight,175);
 assert.equal(r.referenceRoomAmount,null);assert.equal(r.eligible,false);assert.equal(r.verified,false);
});
test('equal and higher totals remain useful reference results',()=>{
 assert.equal(compare(733.6).difference,0);assert.equal(compare(800).difference,-66.4);
});
test('blank fees differ from explicitly zero fees',()=>{
 assert.equal(compare(700).referenceRoomAmount,null);assert.equal(compare(700,0).referenceRoomAmount,700);
 assert.equal(compare(700,70).referenceRoomAmount,630);assert.equal(compare(700,70).eligible,false);
});
test('currency mismatch does not produce converted comparison or BRG decision',()=>{
 const r=compare(600,null,'USD');assert.match(r.error,/같은 통화/);assert.equal(r.difference,undefined);assert.equal(r.eligible,false);
});
test('invalid total and fee inputs never retain a previous calculation',()=>{
 for(const value of [null,NaN,0,-10,Infinity])assert.ok(compare(value).error);
 for(const value of [NaN,-1,700,701,Infinity])assert.ok(compare(700,value).error);
});
test('missing booked total never substitutes booked pretax for inclusive comparison',()=>{
 const r=quickPriceComparison({stay:{...stay,booked:{currency:'EUR',roomSubtotal:666.9}},total:700,currency:'EUR'});
 assert.equal(r.bookedTotal,null);assert.equal(r.difference,null);
});
test('invalid dates never invent a nightly average',()=>{
 for(const checkOut of ['invalid','2027-04-03','2027-04-01']){
  const r=quickPriceComparison({stay:{...stay,checkOut},total:700,currency:'EUR'});assert.equal(r.averageNight,null);
 }
});
test('decimal input supports documented grouping but rejects ambiguous formats and nonfinite numbers',()=>{
 assert.equal(parsePriceInput('', 'EUR'),null);assert.equal(parsePriceInput('1,234.56','EUR'),1234.56);
 for(const value of ['123,45','1e3','-1','Infinity','€700','0x10','12.345','1,23,456'])assert.ok(Number.isNaN(parsePriceInput(value,'EUR')),value);
});
test('whole unit currencies reject fractional units and unsafe numbers',()=>{
 assert.equal(parsePriceInput('56,760','JPY'),56760);assert.ok(Number.isNaN(parsePriceInput('50.5','JPY')));
 assert.ok(Number.isNaN(parsePriceInput('9999999999999999999','EUR')));
});

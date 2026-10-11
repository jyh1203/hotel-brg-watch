import test from 'node:test';
import assert from 'node:assert/strict';
import { roomOnlyFromBreakdown, verifiedPreTaxAmount } from '../site/brg.js';

const breakdown = (total, propertyIncluded) => ({currency:'EUR', displayedTotal:total, verified:true, nonRoomChargesComplete:true,
  charges:[{kind:'tax',amount:20,includedInDisplayedTotal:true,paidAt:'online'},
    {kind:'tax',amount:6,includedInDisplayedTotal:propertyIncluded,paidAt:'property'}]});
test('property tax inside the displayed total is excluded from room rate', () => {
  assert.deepEqual(roomOnlyFromBreakdown(breakdown(226,true),'EUR'),{roomAmount:200,includedNonRoomCharges:26,excludedNonRoomCharges:0,knownPayableTotal:226});
});
test('property tax outside the displayed total is excluded without double subtraction', () => {
  assert.deepEqual(roomOnlyFromBreakdown(breakdown(220,false),'EUR'),{roomAmount:200,includedNonRoomCharges:20,excludedNonRoomCharges:6,knownPayableTotal:226});
});
test('fees and gratuities are also excluded regardless of collection location', () => {
  const b=breakdown(241,true);b.charges.push({kind:'fee',amount:10,includedInDisplayedTotal:true,paidAt:'property'},{kind:'gratuity',amount:5,includedInDisplayedTotal:true,paidAt:'online'});
  assert.equal(roomOnlyFromBreakdown(b,'EUR').roomAmount,200);
});
test('unknown inclusion and incomplete breakdown cannot become a verified room price', () => {
  assert.equal(roomOnlyFromBreakdown(breakdown(226,null),'EUR'),null);
  assert.equal(roomOnlyFromBreakdown({...breakdown(226,true),nonRoomChargesComplete:false},'EUR'),null);
  assert.equal(roomOnlyFromBreakdown(breakdown(226,true),'USD'),null);
  assert.equal(roomOnlyFromBreakdown(breakdown(10,true),'EUR'),null);
  assert.equal(verifiedPreTaxAmount({currency:'EUR',totalAmount:226,preTaxVerified:true,preTaxAmount:190,priceBreakdown:breakdown(226,null)},'EUR'),null);
});
test('a structured breakdown takes priority over an obsolete computed value', () => {
  assert.equal(verifiedPreTaxAmount({currency:'EUR',totalAmount:220,preTaxVerified:true,preTaxAmount:194,priceBreakdown:breakdown(220,false)},'EUR'),200);
});

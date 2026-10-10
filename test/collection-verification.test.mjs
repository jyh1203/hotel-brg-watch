import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSearchEvidence, readOccupancyCounts } from '../src/google-search-evidence.mjs';
import { auditGoogleOffer } from '../site/brg.js';
import { sourceState } from '../site/collection-state.js';

const stay = {checkIn:'2027-04-03',checkOut:'2027-04-07',adults:2,booked:{currency:'EUR',roomSubtotal:700},match:{}};
const evidence = {checkIn:stay.checkIn,checkOut:stay.checkOut,adults:2,children:0,rooms:1};
test('reads actual counters, not child age ranges or missing room defaults', () => {
  assert.deepEqual(readOccupancyCounts('Adults\nRemove adult\n2\n2\nAdd adult\nChildren\nAges 0–17\n0\n0\nAdd child\nDone'),{adults:2,children:0,rooms:null});
  assert.equal(readOccupancyCounts('Children\nAges 0–17\nDone').children,null);
  assert.equal(readOccupancyCounts('Adults\n1\n2\nDone').adults,null);
});
test('requires observed year, dates and full occupancy', () => {
  assert.deepEqual(validateSearchEvidence(evidence,stay),{dateConfirmed:true,occupancyConfirmed:true,roomCountConfirmed:true});
  assert.equal(validateSearchEvidence({...evidence,checkIn:'2026-04-03'},stay).dateConfirmed,false);
  for (const wrong of [{adults:1},{children:1},{rooms:2}]) assert.equal(validateSearchEvidence({...evidence,...wrong},stay).occupancyConfirmed,false);
  assert.deepEqual(validateSearchEvidence({...evidence,rooms:null},stay),{dateConfirmed:true,occupancyConfirmed:true,roomCountConfirmed:false});
});
test('configured dates and adults do not pass BRG condition audit', () => {
  const result={...stay,nights:4,dateConfirmed:false};
  const audit=auditGoogleOffer({stay,result,candidate:{currency:'EUR',totalAmount:600},stale:false});
  for (const key of ['dates','occupancy']) assert.equal(audit.checks.find(x=>x.key===key).ok,false);
  const verified=auditGoogleOffer({stay,result:{...result,dateConfirmed:true,occupancyConfirmed:true,searchEvidence:evidence},candidate:{},stale:false});
  for (const key of ['dates','occupancy']) assert.equal(verified.checks.find(x=>x.key===key).ok,true);
});
test('failed attempts do not replace successful source timestamps', () => {
  const runs=[{capturedAt:'2026-10-10T00:00:00Z',results:[{id:'a',status:'ok',dateConfirmed:true,occupancyConfirmed:true,marriott:{status:'ok'}}]}];
  const attempts={capturedAt:'2026-10-10T01:00:00Z',results:[{id:'a',status:'error',error:'timeout'}]};
  const state=sourceState(runs,attempts,'a','google',Date.parse('2026-10-10T02:00:00Z'));
  assert.equal(state.failed,true);assert.equal(state.successAt,runs[0].capturedAt);assert.equal(state.verified,true);
  assert.equal(sourceState(runs,attempts,'a','marriott',Date.parse('2026-10-12T02:00:00Z')).stale,true);
  assert.equal(sourceState([{...runs[0],results:[{id:'a',status:'ok'}]}],null,'a','google').verified,false);
});

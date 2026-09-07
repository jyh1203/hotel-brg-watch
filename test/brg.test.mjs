import test from 'node:test';
import assert from 'node:assert/strict';
import { threshold, assess } from '../site/brg.js';
import { parseGoogleHotelPrices } from '../src/parse-google-hotels.mjs';
test('same currency excludes exactly 1%; FX includes exactly 2%', () => {
  assert.equal(assess(100,99).pass,false);
  assert.equal(assess(100,98.99).pass,true);
  assert.equal(assess(100,98,{exchanged:true}).pass,true);
  assert.equal(assess(100,98.01,{exchanged:true}).pass,false);
  assert.equal(threshold(56760,false,'JPY').max,56192);
  assert.equal(threshold(269).max,266.30);
  assert.equal(assess(100,90).status,'가격 차이 충족 · 조건 확인 필요');
  assert.equal(assess(0,90).pass,undefined);
});
test('keeps adjacent room conditions separate and recognizes official reference', () => {
  const stay={checkIn:'2027-04-10',checkOut:'2027-04-12',match:{roomPatterns:['queen'],requireFreeCancellation:true}};
  const text='Sponsored·Featured options\nQueen room\n€100\nVisit site\nTwin room\nFree cancellation\n€150\nVisit site\nAll options\nMarriott.com\n€120\nVisit site\nNightly price with taxes + fees\n€130\nVisit site\nBooking.com\n€110\nTrack this hotel';
  const parsed=parseGoogleHotelPrices(text,stay,'EUR');
  assert.equal(parsed.exactCandidate,null);
  assert.equal(parsed.officialReference.totalAmount,240);
  assert.equal(parsed.lowestProvider.provider,'Booking.com');
  assert.equal(parsed.providers.length,2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { threshold, assess, assessRate } from '../site/brg.js';
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

test('rate eligibility distinguishes price, tax basis, conditions and claim window', () => {
  const review = assessRate({
    officialSubtotal: 555,
    offer: 510,
    currency: 'EUR',
    amountBasis: 'unknown',
    roomMatch: true,
    cancellationMatch: null,
    claimWindow: 'open'
  });
  assert.equal(review.tone, 'review');
  assert.equal(review.priceLabel, '가격 기준 충족');
  assert.match(review.reasons.join(' · '), /세전 객실료 미확인/);

  const expired = assessRate({
    officialSubtotal: 555,
    offer: 510,
    currency: 'EUR',
    amountBasis: 'tax-exclusive',
    roomMatch: true,
    cancellationMatch: true,
    claimWindow: 'expired'
  });
  assert.equal(expired.tone, 'no');
  assert.match(expired.reasons.join(' · '), /접수기한 경과/);

  const eligible = assessRate({
    officialSubtotal: 555,
    offer: 510,
    currency: 'EUR',
    amountBasis: 'tax-exclusive',
    roomMatch: true,
    cancellationMatch: true,
    claimWindow: 'open'
  });
  assert.equal(eligible.tone, 'yes');
  assert.equal(eligible.label, '신청 가능 후보');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { threshold, assess, auditGoogleOffer, candidateEvidence } from '../site/brg.js';
import { parseGoogleHotelPrices } from '../src/parse-google-hotels.mjs';
test('same currency excludes exactly 1%', () => {
  assert.equal(assess(100,99).pass,false);
  assert.equal(assess(100,98.99).pass,true);
  assert.equal(threshold(56760,'JPY').max,56192);
  assert.equal(threshold(269).max,266.30);
  assert.equal(assess(100,90).status,'가격 차이 충족 · 조건 확인 필요');
  assert.equal(assess(0,90).pass,undefined);
  assert.deepEqual(assess(100,90,{currency:'EUR',offerCurrency:'USD'}), {
    status:'통화 조건 수동 확인', pass:undefined, currencyMismatch:true
  });
});

test('FX values do not change BRG eligibility', () => {
  assert.equal(assess(100,98,{currency:'EUR'}).pass,true);
  assert.equal(assess(100,98,{currency:'EUR',verified:false,fresh:false}).pass,true);
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

test('audits a lower Google amount separately from actual BRG comparability', () => {
  const stay={
    checkIn:'2027-04-10',checkOut:'2027-04-12',
    booked:{currency:'EUR',roomSubtotal:269,cancellationDeadline:'2027-04-09 23:59'},
    match:{roomPatterns:['moxy sleeper'],bedPatterns:['queen'],excludedPatterns:['twin|single'],requireFreeCancellation:true}
  };
  const candidate={currency:'EUR',totalAmount:252,amountBasis:'pre-tax',context:'Moxy Sleeper Room with 2 Twin/Single Bed(s) · Free cancellation until Apr 9',freeCancellation:true};
  const audit=auditGoogleOffer({stay,result:{dateConfirmed:true,nights:2},candidate,official:{currency:'EUR',totalAmount:269,amountBasis:'pre-tax'},stale:false});
  assert.equal(audit.lowerThanOfficial,true);
  assert.equal(audit.pass,true);
  assert.equal(audit.verified,false);
  assert.deepEqual(audit.evidence.excludedMatches,['twin|single']);
  assert.equal(audit.status,'Google 저가 발견 · BRG 조건 확인 필요');
});

test('does not compare a Google tax-included total until pre-tax is verified', () => {
  const stay={
    checkIn:'2027-04-10',checkOut:'2027-04-12',adults:2,
    booked:{currency:'EUR',roomSubtotal:269,cancellationDeadline:'2027-04-09 23:59'},
    match:{roomPatterns:['moxy sleeper'],bedPatterns:['queen'],requireFreeCancellation:true}
  };
  const result={checkIn:stay.checkIn,checkOut:stay.checkOut,dateConfirmed:true,nights:2,adults:2};
  const base={currency:'EUR',totalAmount:250,amountBasis:'tax-included',context:'Moxy Sleeper Room · 1 queen bed · Free cancellation until Apr 9',freeCancellation:true,cancellationDeadline:'2027-04-09',provider:'Booking.com',publicRate:true,availabilityVerified:true};
  const pending=auditGoogleOffer({stay,result,candidate:base,official:{currency:'EUR',totalAmount:269},stale:false});
  assert.equal(pending.comparisonAmount,null);
  assert.equal(pending.lowerThanOfficial,false);
  assert.equal(pending.status,'Google 세금 포함 총액 확인 · 세전 금액 확인 필요');
  assert.equal(pending.checks.find((check) => check.key === 'basis').ok,false);
  const verified=auditGoogleOffer({stay,result,candidate:{...base,preTaxAmount:230,preTaxVerified:true},official:{currency:'EUR',totalAmount:269},stale:false});
  assert.equal(verified.comparisonAmount,230);
  assert.equal(verified.lowerThanOfficial,true);
  assert.equal(verified.checks.find((check) => check.key === 'basis').ok,true);
});

test('accepts only a matching room, bed and cancellation deadline', () => {
  const stay={
    checkIn:'2027-04-13',checkOut:'2027-04-16',
    booked:{cancellationDeadline:'2027-04-11 23:59'},
    match:{roomPatterns:['classic'],bedPatterns:['king'],excludedPatterns:['queen|twin'],requireFreeCancellation:true}
  };
  assert.equal(candidateEvidence(stay,{context:'Classic Room · 1 king bed · Free cancellation until Apr 11',freeCancellation:true}).roomMatched,true);
  assert.equal(candidateEvidence(stay,{context:'Classic Room · 1 queen bed · Free cancellation until Apr 11',freeCancellation:true}).roomMatched,false);
  assert.equal(candidateEvidence(stay,{context:'Classic Room · 1 king bed · Free cancellation until Apr 10',freeCancellation:true}).cancellationMatched,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseExpediaCheckoutObservation,readExpediaCheckoutObservation} from '../src/ota-expedia.mjs';
import {mergeOtaAttempts,otaScope} from '../src/ota-status.mjs';
import {chromium} from 'playwright';
const stay={hotel:'AC Hotel Carlton Madrid',checkIn:'2027-04-03',checkOut:'2027-04-07',adults:2,booked:{currency:'EUR',room:'Standard King',cancellationDeadline:'2027-04-02'},ota:{hotelAliases:{Expedia:['AC 호텔 칼튼 마드리드 바이 메리어트']}}};
const snapshot={url:'https://www.expedia.co.kr/checkout/session/private?tripId=private',hotel:'AC 호텔 칼튼 마드리드 바이 메리어트',dateText:'Saturday, April 3, 2027 Wednesday, April 7, 2027',room:'스탠다드룸, 킹사이즈침대 1개',adults:2,rooms:1,cancellationText:'Fully refundable before Fri, Apr 2, 2027',pricePanel:'4박\n₩292,732/1박\n₩1,170,926\n세금\n₩117,093\n총 금액\n₩1,288,019\n오늘 결제\n₩0\n숙박 시설에서 결제\n₩1,288,019\nEUR 858.00\nYou will pay these amounts in EUR.'};
test('Expedia final payable EUR total is distinct from estimated KRW tax breakdown',()=>{
 const result=parseExpediaCheckoutObservation(snapshot,stay);
 assert.equal(result.totalAmount,858);assert.equal(result.amountBasis,'tax-included');assert.equal(result.paymentTiming,'property');
 assert.equal(result.roomAmount,null);assert.equal(result.preTaxVerified,false);assert.equal(result.children,null);
 assert.equal(result.availabilityVerified,false);assert.equal(result.publicRateVerified,false);
 assert.equal(result.sourceOrigin,'https://www.expedia.co.kr');assert.doesNotMatch(JSON.stringify(result),/private|tripId/);
});
test('checkout observation rejects wrong hotel, dates, domain and ambiguous currency total',()=>{
 for(const patch of [{hotel:'Other hotel'},{dateText:'April 3, 2026 April 7, 2026'},{url:'https://www.expedia.co.kr.attacker.test/checkout/session/private'},{pricePanel:snapshot.pricePanel+'\nEUR 200.00'},{pricePanel:'세금\n총 금액\n₩1,288,019'}])assert.equal(parseExpediaCheckoutObservation({...snapshot,...patch},stay),null);
});
test('same-scope automatic failures retain a separately observed checkout total',()=>{
 const checkoutObservation={...parseExpediaCheckoutObservation(snapshot,stay),capturedAt:new Date().toISOString()};
 const provider={provider:'Expedia',status:'pending',state:'checkout-total-observed',scope:otaScope(stay),checkoutObservation};
 const prior={results:[{id:'madrid',providers:[provider]}]};
 const failed={provider:'Expedia',status:'error',state:'blocked',scope:otaScope(stay)};
 assert.equal(mergeOtaAttempts(prior,{results:[{id:'madrid',providers:[failed]}]}).results[0].providers[0].checkoutObservation.totalAmount,858);
 assert.equal(mergeOtaAttempts(prior,{results:[{id:'madrid',providers:[{...failed,scope:'other'}]}]}).results[0].providers[0].checkoutObservation,undefined);
});
test('checkout DOM reader only returns safe rate fields and ignores guest/payment inputs',async()=>{
 const browser=await chromium.launch();const page=await browser.newPage();
 try{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<h1>Secure booking</h1><h2>${snapshot.hotel}</h2><div>Saturday, April 3, 2027</div><div>Wednesday, April 7, 2027</div><div>2 adults</div><div>4 nights, 1 room</div><div>${snapshot.room}</div><div>${snapshot.cancellationText}</div><section data-stid="price-summary-card">${snapshot.pricePanel.replaceAll('\n','<br>')}</section><input value="private guest"><input value="private card">`}));
  await page.goto(snapshot.url);const result=await readExpediaCheckoutObservation(page,stay);
  assert.equal(result.totalAmount,858);assert.equal(result.adults,2);assert.equal(result.rooms,1);
  assert.doesNotMatch(JSON.stringify(result),/private guest|private card|tripId/);
 }finally{await browser.close();}
});

import test from 'node:test';import assert from 'node:assert/strict';
import {parseBookingCheckoutObservation,bookingCheckoutSnapshot} from '../src/ota-booking-checkout.mjs';
import {chromium} from 'playwright';
const stay={hotel:'AC Hotel Carlton Madrid',checkIn:'2027-04-03',checkOut:'2027-04-07',adults:2,booked:{currency:'EUR'},ota:{hotelAliases:{'Booking.com':['AC 호텔 칼튼 마드리드, 메리어트 라이프스타일 호텔']}}};
const snapshot={origin:'https://secure.booking.com',path:'/book.html',hotel:stay.ota.hotelAliases['Booking.com'][0],dates:'2027년 4월 3일 (토) 2027년 4월 7일 (수)',occupancy:'4박, 객실 1개, 성인 2명',room:'스탠다드 킹룸 x 1',pricePanel:'결제 요금 내역\n금액\n€ 702\n+ 세금 및 기타 요금(€ 70.20)\n요금 정보\n세금 및 기타 비용(€ 70.20) 별도\n10 % 부가가치세(VAT)\n€ 70.20'};
test('Booking checkout uses scoped explicit room plus excluded charges, not percent or URL',()=>{
 const result=parseBookingCheckoutObservation(snapshot,stay);assert.equal(result.roomAmount,702);assert.equal(result.taxesAndFees,70.2);assert.equal(result.totalAmount,772.2);assert.equal(result.preTaxVerified,true);assert.equal(result.publicRateVerified,false);assert.equal(result.children,null);
 for(const patch of [{origin:'https://secure.booking.com.attacker.test'},{dates:'2026년 4월 3일 2026년 4월 7일'},{hotel:'Other hotel'},{occupancy:'4박, 객실 1개, 성인 3명'},{room:'스탠다드 퀸룸 x 1'},{pricePanel:'금액 € 702 10 % 부가가치세(VAT)'},{pricePanel:snapshot.pricePanel+'\n금액 € 800'}])assert.equal(parseBookingCheckoutObservation({...snapshot,...patch},stay),null);
});
test('Booking checkout snapshot does not return session URL or guest/payment values',async()=>{
 const browser=await chromium.launch();const page=await browser.newPage();try{await page.route('**/*',route=>route.fulfill({body:`<h1>${snapshot.hotel}</h1><div>${snapshot.dates}</div><div>${snapshot.occupancy}</div><div>${snapshot.room}</div><div id="bp-price-summary">${snapshot.pricePanel.replaceAll('\n','<br>')}</div><input value="SECRET_CARD"><input value="SECRET_GUEST">`,contentType:'text/html; charset=utf-8'}));await page.goto('https://secure.booking.com/book.html?sid=SECRET_SESSION');const safe=await page.evaluate(bookingCheckoutSnapshot);assert.equal(parseBookingCheckoutObservation(safe,stay).totalAmount,772.2);assert.doesNotMatch(JSON.stringify(safe),/SECRET_|sid=/);}finally{await browser.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {belongsToProvider,allowedOutbound,otaPageState,parseOtaPriceDetails,validateOtaSnapshot,readGoogleOtaLinks,collectOtaChecks,readDedicatedOtaTabs} from '../src/ota.mjs';
const stay={hotel:'AC Hotel Carlton Madrid',checkIn:'2027-04-03',checkOut:'2027-04-07',adults:2,
 booked:{currency:'EUR',cancellationDeadline:'2027-04-02 23:59'},match:{roomPatterns:['standard'],bedPatterns:['king'],excludedPatterns:['twin|queen'],requireFreeCancellation:true}};
const lines=['Room price','€200.00','Taxes and fees included','€20.00','City tax at property not included','€6.00','Total','€220.00'];
const snapshot={text:'Selected room',url:'https://www.booking.com/hotel/example',hotel:stay.hotel,dates:[stay.checkIn,stay.checkOut],adults:2,children:0,rooms:1,
 room:'Standard King Room · Free cancellation until 2027-04-02',freeCancellation:true,cancellationDeadline:'2027-04-02',publicRate:true,priceLines:lines,selectedOffer:true};
test('OTA destinations reject lookalikes and non-https URLs',()=>{
 assert.equal(belongsToProvider('https://www.booking.com/hotel/a','Booking.com'),true);
 for(const url of ['https://booking.com.attacker.test/','http://www.booking.com/','file:///etc/passwd'])assert.equal(belongsToProvider(url,'Booking.com'),false);
 assert.equal(allowedOutbound('https://www.google.com/aclk?observed=1','Agoda'),true);
 assert.equal(allowedOutbound('https://www.google.com/travel/search?q=hotel','Agoda'),false);
 assert.equal(belongsToProvider('https://www.expedia.co.kr/','Expedia'),true);
});
test('dedicated-tab path reads a synthetic selected offer without navigation or closing tabs',async()=>{
 const browser=await chromium.launch({headless:true});const context=await browser.newContext();
 try{
 await context.route('**/*',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:`<h1>${stay.hotel}</h1><input type="date" value="${stay.checkIn}"><input type="date" value="${stay.checkOut}"><div data-testid="occupancy-summary">2 adults · 0 children · 1 room</div><div data-testid="selected-room">Standard King Room · Free cancellation until 2027-04-02 · Public rate · Total €220</div><div data-testid="price-summary">${lines.map(x=>`<div>${x}</div>`).join('')}</div>`}));
 const page=await context.newPage();await page.goto('https://www.booking.com/hotel/test');
 const before=page.url();const checks=await readDedicatedOtaTabs(browser,stay);
 assert.equal(checks.find(x=>x.provider==='Booking.com').state,'room-price-verified');
 assert.equal(checks.find(x=>x.provider==='Booking.com').roomAmount,200);
 assert.equal(checks.find(x=>x.provider==='Agoda').state,'tab-unavailable');
 assert.equal(page.url(),before);assert.equal(page.isClosed(),false);assert.equal(context.pages().length,1);
 }finally{await context.close();await browser.close();}
});
test('all three OTA price adapters exclude outside-property tax without double subtraction',()=>{
 for(const provider of ['Booking.com','Agoda','Expedia']){
 const result=parseOtaPriceDetails(lines,provider,'EUR');assert.equal(result.roomAmount,200);assert.equal(result.knownPayableTotal,226);
 }
});
test('included property tax is deducted only once',()=>{
 const result=parseOtaPriceDetails(['Room price €200','Taxes and fees €20','City tax at property included €6','Total €226'],'Expedia','EUR');
 assert.equal(result.roomAmount,200);assert.equal(result.knownPayableTotal,226);
});
test('missing subtotals, ambiguous property fees, currencies and unexplained arithmetic fail closed',()=>{
 for(const sample of [ ['Total €220'], ['Room price €200','City tax payable at property €20','Total €220'],['Room price €200','Taxes €10','Total €220'],['Room price $200','Taxes $20','Total $220'],['Room price €200','Taxes €20','Member discount €10','Total €210'] ])
  assert.equal(parseOtaPriceDetails(sample,'Agoda','EUR'),null);
});
test('hotel, dates, occupancy, selected room, public rate and total must be independently verified',()=>{
 assert.equal(validateOtaSnapshot(snapshot,stay,'Booking.com').status,'ok');
 assert.equal(validateOtaSnapshot({...snapshot,hotel:stay.hotel+' by Marriott'},stay,'Booking.com').status,'ok');
 const localized={...stay,ota:{hotelAliases:{'Booking.com':['AC 호텔 칼튼 마드리드, 메리어트 라이프스타일 호텔']}}};
 assert.equal(validateOtaSnapshot({...snapshot,hotel:'AC 호텔 칼튼 마드리드, 메리어트 라이프스타일 호텔'},localized,'Booking.com').status,'ok');
 for(const patch of [{hotel:'Other Hotel'},{dates:[]},{adults:1},{children:1},{rooms:2},{room:'Twin room'},{freeCancellation:false},{publicRate:false},{priceLines:['Total €220']},{selectedOffer:false}]){
  const result=validateOtaSnapshot({...snapshot,...patch},stay,'Booking.com');assert.notEqual(result.status,'ok');assert.equal(result.roomAmount,undefined);
 }
 assert.equal(validateOtaSnapshot(snapshot,stay,'Booking.com').availabilityVerified,false);
});
test('CAPTCHA and blank pages are not interpreted as successful prices',()=>{
 assert.equal(otaPageState('Show us your human side...'),'blocked');assert.equal(otaPageState(''),'empty-page');
 assert.equal(validateOtaSnapshot({...snapshot,text:'Access denied'},stay,'Booking.com').state,'blocked');
});
test('Google links use exact provider cards and read-only collection records a blocked destination',async()=>{
 const browser=await chromium.launch({headless:true});const context=await browser.newContext();
 try{
 const page=await context.newPage();
 await page.setContent('<div>Other Hotel Booking.com<a href="https://www.google.com/aclk?wrong=1">Visit site</a></div><div>Expedia.co.kr Free cancellation<a href="https://www.google.com/aclk?actual=1">Visit site</a></div>');
 const links=await readGoogleOtaLinks(page);assert.deepEqual(links.map(x=>x.provider),['Expedia']);
 const requests=[];
 await context.route('**/*',async route=>{
  requests.push(route.request().method());
  return route.fulfill({status:200,contentType:'text/html',body:'<h1>Show us your human side...</h1>'});
 });
 const checks=await collectOtaChecks(context,page,stay);
 assert.equal(checks.find(x=>x.provider==='Expedia').state,'blocked');
 assert.equal(checks.find(x=>x.provider==='Booking.com').state,'link-unavailable');
 assert.ok(requests.every(x=>x==='GET'));assert.doesNotMatch(JSON.stringify(checks),/actual=1|wrong=1|human side/);
 }finally{await context.close();await browser.close();}
});

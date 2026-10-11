import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {parseOccupancy,parseExplicitDates,readBookingSearch,observedExpediaSearchUrl,setAgodaSearch,setBookingSearch} from '../src/ota-search.mjs';
import {otaScope,mergeOtaAttempts} from '../src/ota-status.mjs';
import {normalizeBookingRoom,bookingCancellation,readSelectedBookingOffer} from '../src/ota-booking.mjs';
import {validateOtaSnapshot} from '../src/ota.mjs';
const stay={hotel:'AC Hotel Carlton Madrid',checkIn:'2027-04-03',checkOut:'2027-04-07',adults:2,
 booked:{currency:'EUR',room:'Standard King Room',cancellationDeadline:'2027-04-02 23:59'},match:{roomPatterns:['standard'],bedPatterns:['king'],excludedPatterns:['twin|queen'],requireFreeCancellation:true}};
test('observed Korean/English occupancy preserves explicit zero, not missing children',()=>{
 for(const text of ['성인 2명 · 아동 0명 · 객실 1개','2 adults · 0 children · 1 room'])assert.deepEqual(parseOccupancy(text),{adults:2,children:0,rooms:1});
 assert.ok(Number.isNaN(parseOccupancy('2 adults · 1 room').children));
});
test('full year is required for localized dates; no request-year substitution',()=>{
 assert.deepEqual(parseExplicitDates('2027년 4월 3일 · 7 Apr 2027 · April 2, 2027'),['2027-04-03','2027-04-07','2027-04-02']);
 assert.deepEqual(parseExplicitDates('4월 3일 · 7 Apr'),[]);
});
test('exclusive cancellation dates are distinguished from inclusive dates',()=>{
 assert.equal(bookingCancellation('2027년 4월 3일 전까지 무료 취소 가능'),'2027-04-02');
 assert.equal(bookingCancellation('Free cancellation before 3 April 2027'),'2027-04-02');
 assert.equal(bookingCancellation('Free cancellation until 2 April 2027'),'2027-04-02');
 assert.equal(bookingCancellation('Free cancellation'),null);
 assert.match(normalizeBookingRoom('스탠다드 플러스 킹룸'),/Plus King/);
});
test('Expedia date navigation is derived only from observed same-hotel public links',()=>{
 const canonical='https://www.expedia.com/Madrid-Hotels-AC-Hotel.h3691.Hotel-Information';
 const link='https://www.expedia.com/Hotel-Search?startDate=2026-10-11&endDate=2026-10-12&adults=2&PinnedHotelID=3691&tracking=private';
 const url=new URL(observedExpediaSearchUrl(canonical,link,stay));
 assert.equal(url.searchParams.get('startDate'),stay.checkIn);assert.equal(url.searchParams.get('endDate'),stay.checkOut);
 assert.equal(url.searchParams.has('tracking'),false);
 for(const bad of [link.replace('PinnedHotelID=3691','PinnedHotelID=999'),link.replace('www.expedia.com','www.expedia.com.attacker.test'),link.replace('&adults=2','')])assert.equal(observedExpediaSearchUrl(canonical,bad,stay),null);
});
test('failed OTA attempts preserve only last successful values in the exact same scope',()=>{
 const good={provider:'Booking.com',status:'ok',roomAmount:200,scope:otaScope(stay),capturedAt:'2026-10-11T01:00:00Z'};
 const previous={results:[{id:'madrid',providers:[good]},{id:'other',providers:[]}]};
 const failed={...good,status:'error',roomAmount:undefined,state:'blocked',capturedAt:'2026-10-11T02:00:00Z'};
 const result=mergeOtaAttempts(previous,{results:[{id:'madrid',providers:[failed]}]});
 assert.equal(result.results.length,2);const attempt=result.results.find(x=>x.id==='madrid').providers[0];
 assert.equal(attempt.status,'error');assert.equal(attempt.roomAmount,undefined);assert.equal(attempt.lastSuccessful.roomAmount,200);
 const changed=mergeOtaAttempts(previous,{results:[{id:'madrid',providers:[{...failed,scope:otaScope({...stay,checkIn:'2027-04-04'})}]}]});
 assert.equal(changed.results.find(x=>x.id==='madrid').providers[0].lastSuccessful,undefined);
});
test('Agoda verifies rendered conditions after navigation, never just the requested URL',async()=>{
 const browser=await chromium.launch();const page=await browser.newPage();
 let wrong=false;
 const html=()=>`<button data-selenium="calendar-next-month-button">Next Month</button><div aria-label="Sat Apr 03 2027">3</div><div aria-label="Wed Apr 07 2027">7</div><button data-selenium="searchButton" onclick="location.href='?checkIn=2027-04-03&checkOut=2027-04-07'">SEARCH</button><div data-selenium="checkInText">3 Apr 2027</div><div data-selenium="checkOutText">${wrong?'8':'7'} Apr 2027</div><button data-selenium="occupancyBox">2 adults 1 room</button><div data-selenium="desktop-occ-adult-value">2</div><div data-selenium="desktop-occ-children-value">0</div><div data-selenium="desktop-occ-room-value">1</div>`;
 try{
 await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:html()}));
 await page.goto('https://www.agoda.com/hotel/test');
 const valid=await setAgodaSearch(page,stay);assert.equal(valid.state,'search-set');assert.equal(valid.children,0);
 wrong=true;await page.goto('https://www.agoda.com/hotel/test');
 assert.equal((await setAgodaSearch(page,stay)).state,'search-conditions-unverified');
 }finally{await browser.close();}
});
const row=(name,price=200,charge='20',policy='2027년 4월 3일 전까지 무료 취소 가능')=>`<tr><td><a class="hprt-roomtype-icon-link">${name}</a></td><td><div class="hprt-price-block"><div class="bui-price-display__value">€ ${price}</div><div data-excl-charges-raw="${charge}">+ 세금 및 기타 요금(€ 20)</div></div></td><td>${policy}</td><td><select data-testid="select-room-trigger"><option value="0">0</option><option value="1">1</option></select></td></tr>`;
test('selected table subtotal excludes taxes once and never clicks a reservation button',async()=>{
 const browser=await chromium.launch();const page=await browser.newPage();
 try{
 await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<h1>${stay.hotel}</h1><a data-testid="header-small-sign-in-button">로그인</a><table class="hprt-table">${row('스탠다드 플러스 킹룸',150)}${row('스탠다드 킹룸')}</table><button onclick="window.booked=true">예약 확정</button>`}));
 await page.goto('https://www.booking.com/hotel/test');
 const search={dates:[stay.checkIn,stay.checkOut],adults:2,children:0,rooms:1};
 const offer=await readSelectedBookingOffer(page,stay,search);
 assert.equal(offer.snapshot.room,'Standard King Room');
 const result=validateOtaSnapshot(offer.snapshot,stay,'Booking.com');
 assert.equal(result.status,'ok');assert.equal(result.roomAmount,200);assert.equal(result.knownPayableTotal,220);
 assert.equal(result.priceBasis,'explicit-room-subtotal');assert.equal(result.availabilityVerified,false);
 assert.deepEqual(await page.locator('select').evaluateAll(ns=>ns.map(n=>n.value)),['0','1']);
 assert.equal(await page.evaluate(()=>window.booked),undefined);
 }finally{await browser.close();}
});
test('calendar evidence uses endpoints rather than any day inside a wider range',async()=>{
 const browser=await chromium.launch();const page=await browser.newPage();
 try{
 await page.setContent('<span data-date="2027-04-03" aria-checked="true">3</span><span data-date="2027-04-07" aria-checked="true">7</span><span data-date="2027-04-10" aria-checked="true">10</span><button data-testid="occupancy-config">성인 2명 · 아동 0명 · 객실 1개</button>');
 assert.deepEqual((await readBookingSearch(page)).dates,['2027-04-03','2027-04-10']);
 }finally{await browser.close();}
});
test('an unverified/partial charge cannot become a selected room price',async()=>{
 const browser=await chromium.launch();const page=await browser.newPage();
 try{
 await page.setContent(`<h1>${stay.hotel}</h1><table class="hprt-table">${row('스탠다드 킹룸',200,'not-a-number')}</table>`);
 assert.equal((await readSelectedBookingOffer(page,stay,{})).state,'price-breakdown-unverified');
 }finally{await browser.close();}
});

test('failed Booking search handles the pending navigation rejection',async()=>{
 const node={first(){return this;},filter(){return this;},isVisible:async()=>true,waitFor:async()=>{},click:async()=>{}};
 let reads=0;
 const page={locator:()=>node,keyboard:{press:async()=>{}},
  evaluate:async()=>({dates:++reads===1?[]:[stay.checkIn,stay.checkOut],occupancy:'2 adults 0 children 1 room'}),
  getByRole:()=>({...node,click:async()=>{throw new Error('search-click-failed');}}),
  waitForNavigation:()=>new Promise((_,reject)=>setTimeout(()=>reject(new Error('navigation-closed')),10))};
 await assert.rejects(setBookingSearch(page,stay),/search-click-failed/);
 // node:test detects an unhandled rejection after the click failure.
 await new Promise(resolve=>setTimeout(resolve,30));
});

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {chromium} from 'playwright';
import {readHotelsSelectedDates} from '../src/ota-hotels-precision.mjs';import {readMarriottGuestCounts} from '../src/marriott.mjs';import {parseMarriottDetailedPrice,markFlexibleMemberDetails} from '../src/marriott-precision.mjs';
const actual=JSON.parse(fs.readFileSync(new URL('./fixtures/precision/hotels-bordeaux-observed.json',import.meta.url)));
test('Hotels.com actual pressed-date controls expose the observed year, not URL/config date assumptions',async()=>{
 const b=await chromium.launch();try{const p=await b.newPage();await p.setContent(`<div role="dialog">${actual.selectedCalendarHtml}</div>`);assert.deepEqual(await p.evaluate(readHotelsSelectedDates),{checkIn:'2027-04-10',checkOut:'2027-04-12'});
 await p.setContent('<div role="dialog"><div aria-pressed="true">10</div><div aria-pressed="true">12</div></div>');assert.equal(await p.evaluate(readHotelsSelectedDates),null);
 }finally{await b.close();}
});
test('Marriott counters read visible selected values and do not assume stored adult/child/room defaults',async()=>{
 const b=await chromium.launch();try{const p=await b.newPage();await p.setContent('<input style="display:none" name="numberOfAdults" value="9"><div><button aria-label="Decrease number of Adults">−</button><span>3</span><button aria-label="Increase number of Adults">+</button></div><input aria-label="Children per room" value="0"><input name="numberOfRooms" value="1">');assert.deepEqual(await p.evaluate(readMarriottGuestCounts),{adults:3,children:0,rooms:1});await p.setContent('<input type="hidden" name="numberOfAdults" value="2">');assert.deepEqual(await p.evaluate(readMarriottGuestCounts),{});
 }finally{await b.close();}
});
test('Marriott explicit totals must reconcile and a tax-display toggle or tax ratio is not pretax proof',()=>{
 assert.equal(parseMarriottDetailedPrice('Show with taxes and fees not checked 269 Total Per Room','EUR'),null);
 assert.equal(parseMarriottDetailedPrice('Room subtotal 269 EUR Taxes and fees 9.80 EUR Grand total 278.80 EUR','EUR'),null);
 assert.equal(parseMarriottDetailedPrice('Room subtotal 269 EUR Taxes and fees 9.80 EUR Grand total 278.80 EUR All rates are quoted exclusive of VAT.','EUR').preTaxAmount,269);
 assert.equal(parseMarriottDetailedPrice('Room subtotal 269 EUR Taxes and fees 9.80 EUR Grand total 287 EUR','EUR'),null);
});

test('policy details bind to the selected flexible member offer, never an earlier cheaper promotion',async()=>{
 const b=await chromium.launch();try{const p=await b.newPage();await p.setContent('<section><a data-testid="rate-modal" id="promo">Info promo</a><button aria-label="Select Member Rate Stay Longer on Us Member Rate">Select</button></section><section><div><a data-testid="rate-modal" id="flex">Info flexible</a><button aria-label="Select Flexible Rate Member Rate">Select</button></div></section>');assert.equal(await p.evaluate(markFlexibleMemberDetails),true);assert.equal(await p.locator('[data-brg-flexible-details=selected]').getAttribute('id'),'flex');
 await p.setContent('<section><a data-testid="rate-modal" id="promo">Info promo</a><button aria-label="Select Member Rate Stay Longer on Us Member Rate">Select</button><div><button aria-label="Select Flexible Rate Member Rate">Select</button></div></section>');assert.equal(await p.evaluate(markFlexibleMemberDetails),false);
 }finally{await b.close();}
});

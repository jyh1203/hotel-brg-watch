import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {readMarriottCalendarRange} from '../src/marriott.mjs';
test('Marriott range uses visible full-year calendar endpoints despite hidden summary, rejecting off-month cells and wrong year',async()=>{
 const browser=await chromium.launch();try{
  const page=await browser.newPage();
  await page.setContent(`<span class="drp-selected" style="display:none">Apr 3-Apr 7</span><table><thead><tr><th class="month">March 2027</th></tr></thead><tbody><tr><td class="start-date off">3</td><td class="end-date off">7</td></tr></tbody></table><table><thead><tr><th class="month">April 2027</th></tr></thead><tbody><tr><td class="start-date">3</td><td class="end-date">7</td></tr></tbody></table><table style="display:none"><thead><tr><th class="month">April 2026</th></tr></thead><tbody><tr><td class="start-date">3</td><td class="end-date">7</td></tr></tbody></table>`);
  assert.deepEqual(await page.evaluate(readMarriottCalendarRange),{checkIn:'2027-04-03',checkOut:'2027-04-07'});
  await page.locator('th.month').nth(1).evaluate(n=>n.textContent='April 2026');assert.deepEqual(await page.evaluate(readMarriottCalendarRange),{checkIn:'2026-04-03',checkOut:'2026-04-07'});
  await page.locator('td.end-date:not(.off)').first().evaluate(n=>n.classList.remove('end-date'));assert.equal(await page.evaluate(readMarriottCalendarRange),null);
 }finally{await browser.close();}
});

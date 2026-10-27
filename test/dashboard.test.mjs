import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {chromium} from 'playwright';import fs from 'node:fs';
import {stayScope} from '../site/rate-display.js';
const fixture=JSON.parse(fs.readFileSync(new URL('../site/data.json',import.meta.url),'utf8'));
test('simple hotel dashboard prioritizes prices, all-in fallback, taxes, actions and collapsed detail',async()=>{
 const server=spawn(process.execPath,['src/server.mjs'],{stdio:'ignore',env:{...process.env,PORT:'4174'}});const browser=await chromium.launch();
 try{
  for(let i=0;i<30;i++){if((await fetch('http://127.0.0.1:4174/').catch(()=>null))?.ok)break;await new Promise(r=>setTimeout(r,100));}
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4174/',{waitUntil:'networkidle'});
  assert.equal(await page.locator('.card').count(),fixture.config.stays.length);assert.equal(await page.locator('#summary>div').count(),2);
  assert.equal(await page.locator('details[open]').count(),0);assert.equal(await page.locator('.chart,.brg-threshold,.google-opportunity,.brg-form').count(),0);
  const madrid=page.locator('[data-stay-id="madrid-carlton"]');const booking=madrid.locator('.seller-price').filter({hasText:'Booking.com'});const expedia=madrid.locator('.seller-price').filter({hasText:'Expedia'});
  assert.match(await booking.innerText(),/Google 표시가.*€772.*세금 미확인/s);
  assert.match(await expedia.innerText(),/Google 표시가.*€774.*세금 미확인/s);assert.doesNotMatch(await expedia.innerText(),/세전 확인 필요|비교.*보류|세금·기타요금/);
  assert.match(await madrid.locator('.official-price').innerText(),/€760/);assert.doesNotMatch(await madrid.locator('.official-price').innerText(),/€836/);
  assert.equal(await page.getByRole('link',{name:'BRG 신청 ↗',exact:true}).count(),fixture.config.stays.length);
  assert.equal(await madrid.locator('.hotel-details p').first().isVisible(),false);
  await madrid.locator('.hotel-details>summary').click();assert.equal(await madrid.locator('.hotel-details p').first().isVisible(),true);await madrid.locator('.hotel-details>summary').click();
  for(const width of [1440,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  const synthetic=structuredClone(fixture),stay=synthetic.config.stays[0],capturedAt=new Date().toISOString();
  synthetic.runs.push({capturedAt,results:[{id:stay.id,status:'error',marriott:{status:'ok',prepaid:false,currency:'EUR',totalAmount:640,amountBasis:'pre-tax',checkIn:stay.checkIn,checkOut:stay.checkOut,adults:stay.adults,capturedAt}}]});
  synthetic.collectorStatus={capturedAt,results:[{id:stay.id,status:'ok'}]};synthetic.otaStatus.results.find(x=>x.id===stay.id).providers.find(x=>x.provider==='Expedia').checkoutObservation={currency:'EUR',totalAmount:226,amountBasis:'tax-included',capturedAt};
  await page.route('**/data.json*',r=>r.fulfill({json:synthetic}));await page.reload({waitUntil:'networkidle'});
  assert.match(await madrid.locator('.price-alert').innerText(),/공식가가 예약보다 €26\.90? 낮아요/);
  await page.evaluate(()=>localStorage.setItem('brg:madrid-carlton',JSON.stringify({official:'1',offer:'1'})));await page.reload({waitUntil:'networkidle'});
  assert.match(await madrid.locator('.official-price').innerText(),/€640/);assert.match(await madrid.locator('.seller-price').filter({hasText:'Expedia'}).innerText(),/€226.*세금 포함/s);
  assert.doesNotMatch(await page.locator('body').innerText(),/공식 화면 금액 입력|저장하고 계산|BRG 신청 상한/);assert.deepEqual(errors,[]);
 }finally{await browser.close();server.kill('SIGTERM');}
});

import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {chromium} from 'playwright';
test('automatic verification evidence is discoverable, with source confirmations separate from eligibility',async()=>{
 const server=spawn(process.execPath,['src/server.mjs'],{stdio:'ignore',env:{...process.env,PORT:'4179'}}),browser=await chromium.launch();
 try{
  for(let i=0;i<30;i++){if((await fetch('http://127.0.0.1:4179/').catch(()=>null))?.ok)break;await new Promise(r=>setTimeout(r,100));}
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4179/',{waitUntil:'networkidle'});
  const root=page.locator('[data-stay-id="bordeaux-moxy"] .claim-plan'),detail=root.locator('.precision-details');assert.equal(await detail.locator('.precision-source').first().isVisible(),false);
  await detail.locator(':scope>summary').click();assert.equal(await detail.locator('.precision-source').count(),2);
  const hotels=detail.locator('.precision-source').filter({hasText:'Hotels.com'});assert.match(await hotels.innerText(),/성인 2.*아동 0.*객실 1/s);assert.match(await hotels.innerText(),/Europe\/Paris/);assert.match(await hotels.innerText(),/€252\.72.*€35\.08.*€287\.80/s);assert.match(await hotels.innerText(),/객실 이름 대응 추가 확인/);
  assert.notEqual(await root.locator('.claim-overview').getAttribute('data-plan-state'),'ready');assert.match(await detail.innerText(),/일치 항목 수만으로 신청 가능하다는 뜻은 아닙니다/);
  const card=page.locator('[data-stay-id="bordeaux-moxy"]');await card.locator('.price-details>summary').click();assert.match(await card.locator('.official-price').innerText(),/세금 미확인/);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.setViewportSize({width:390,height:1000});await page.screenshot({path:'artifacts/precision-evidence-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 }finally{await browser.close();server.kill('SIGTERM');}
});

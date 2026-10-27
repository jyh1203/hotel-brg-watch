import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {chromium} from 'playwright';import fs from 'node:fs';
const fixture=JSON.parse(fs.readFileSync(new URL('../site/data.json',import.meta.url),'utf8'));
test('Google amount compares with no fees, optional fees do not unlock BRG, mobile forms remain usable',async()=>{
 const server=spawn(process.execPath,['src/server.mjs'],{stdio:'ignore',env:{...process.env,PORT:'4176'}});
 const browser=await chromium.launch();
 try{
  for(let i=0;i<30;i++){if((await fetch('http://127.0.0.1:4176/').catch(()=>null))?.ok)break;await new Promise(r=>setTimeout(r,100));}
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4176/',{waitUntil:'networkidle'});
  const card=page.locator('[data-stay-id="madrid-carlton"]').first();
  const form=card.locator('.quick-price-form');const output=form.locator('output');
  const before=await card.locator('.rate-list').innerText();
  assert.equal(await form.isVisible(),false);
  await card.locator('.quick-price>summary').click();
  await form.getByLabel('Google 숙박 전체 총액',{exact:true}).fill('700');
  await form.getByRole('button',{name:'총액 비교',exact:true}).click();
  assert.match(await output.innerText(),/Google 입력 총액 €700/);
  const booked=fixture.config.stays.find(s=>s.id==='madrid-carlton').booked.total;
  const difference=new Intl.NumberFormat('ko-KR',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(booked-700);
  assert.ok((await output.innerText()).includes(`예약보다 ${difference} 낮음`));
  assert.match(await output.innerText(),/세전 객실료 미확인/);
  assert.equal(await form.locator('[name=fees]').isVisible(),false);
  await form.getByLabel('Google 숙박 전체 총액',{exact:true}).fill('710');assert.equal(await output.innerText(),'');
  await form.locator('[name=currency]').selectOption('USD');await form.getByRole('button',{name:'총액 비교'}).click();
  assert.match(await output.innerText(),/같은 통화/);assert.doesNotMatch(await output.innerText(),/예약보다/);
  await form.locator('[name=currency]').selectOption('EUR');
  await form.locator('.optional-fees>summary').click();await form.locator('[name=fees]').fill('0');await form.getByRole('button',{name:'총액 비교'}).click();
  assert.match(await output.innerText(),/세전 참고 객실료 €710/);assert.match(await output.innerText(),/BRG 적격 판정이나 저장된 가격에는 반영하지 않습니다/);
  await form.locator('[name=fees]').fill('711');await form.getByRole('button',{name:'총액 비교'}).click();assert.equal(await output.getAttribute('data-status'),'error');
  assert.equal(await card.locator('.rate-list').innerText(),before);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.setViewportSize({width:390,height:900});await form.locator('[name=fees]').fill('');await form.getByRole('button',{name:'총액 비교'}).click();
  await page.screenshot({path:'artifacts/quick-price-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'artifacts/quick-price-desktop.png',fullPage:true});
  await page.reload({waitUntil:'networkidle'});await card.locator('.quick-price>summary').click();assert.equal(await form.locator('[name=total]').inputValue(),'');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();server.kill('SIGTERM');}
});

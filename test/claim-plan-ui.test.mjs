import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {chromium} from 'playwright';import fs from 'node:fs';
const fixture=JSON.parse(fs.readFileSync(new URL('../site/data.json',import.meta.url),'utf8'));
test('reservation-first UI: two gates, booking modes, private preferences, points, scoped reset and packet',async()=>{
 const server=spawn(process.execPath,['src/server.mjs'],{stdio:'ignore',env:{...process.env,PORT:'4177'}}),browser=await chromium.launch();
 try{
  for(let i=0;i<30;i++){if((await fetch('http://127.0.0.1:4177/').catch(()=>null))?.ok)break;await new Promise(r=>setTimeout(r,100));}
  const page=await browser.newPage({timezoneId:'America/New_York'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4177/',{waitUntil:'networkidle'});
  const card=page.locator('[data-stay-id="bordeaux-moxy"]'),root=card.locator('.claim-plan');
  assert.match(await root.locator('.plan-eyebrow').innerText(),/現在|현재 공식 요금으로 새 예약 검토/);
  assert.match(await root.locator('.dual-check').innerText(),/BRG 조건.*내 예약보다 유리/s);
  assert.match(await root.locator('.claim-window').innerText(),/새 공식 예약 완료 후 24시간/);
  assert.doesNotMatch(await root.locator('.claim-window').innerText(),/예약 시각.*확인/);
  assert.match(await root.locator('.plan-prices').innerText(),/€252\.72.*€189\.54.*미확인/s);
  assert.match(await root.locator('.estimate-note').innerText(),/Marriott 세금·VAT가 미확인/);
  assert.equal(await root.locator('.claim-overview').getAttribute('data-plan-state'),'checking');
  assert.equal(await card.locator('.rate-list').isVisible(),false);
  await root.locator('.plan-primary').click();assert.equal(await root.locator('.claim-details').getAttribute('open'),'');
  assert.match(await root.locator('.claim-checks').innerText(),/미확인.*취소 시각/s);
  await root.locator('.packet>summary').click();assert.match(await root.locator('textarea').inputValue(),/검토 초안.*예약 미실행.*252\.72 EUR/s);
  await root.locator('.plan-settings>summary').click();const form=root.locator('form');
  await form.locator('[name=reward]').selectOption('points');await form.getByRole('button',{name:'검토 기준 적용',exact:true}).click();
  assert.match(await root.locator('.plan-prices').innerText(),/5,000P 별도.*€252\.72/s);
  assert.doesNotMatch(await root.locator('.plan-prices').innerText(),/€189\.54/);
  await page.reload({waitUntil:'networkidle'});await root.locator('.plan-settings>summary').click();assert.equal(await root.locator('[name=reward]').inputValue(),'points');
  await root.locator('[name=mode]').selectOption('new');await root.getByRole('button',{name:'검토 기준 적용',exact:true}).click();assert.match(await root.locator('.plan-message').innerText(),/실제 예약 시각/);
  const raw=new Date(Date.now()-3600000).toLocaleString('sv-SE',{timeZone:'Asia/Seoul'}).slice(0,16).replace(' ','T');
  await root.locator('[name=reservedAt]').fill(raw);await root.locator('[name=reservedRoomAmount]').fill('269');await root.locator('[name=bookingConfirmed]').check();await root.locator('[name=checkInTime]').fill('15:00');await root.getByRole('button',{name:'검토 기준 적용',exact:true}).click();
  assert.match(await root.locator('.claim-window').innerText(),/신청 마감.*한국시간/s);assert.match(await root.locator('.plan-eyebrow').innerText(),/새 공식 예약으로 신청/);
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('brg-plan:v1:bordeaux-moxy')));assert.equal(stored.reservedAt,new Date(raw+':00+09:00').toISOString());
  const dataRequests=[];page.on('request',r=>{if(r.method()!=='GET')dataRequests.push(r.url());});
  await root.locator('.reset-plan').click();assert.match(await root.locator('.plan-eyebrow').innerText(),/새 예약 검토/);assert.equal(await page.evaluate(()=>localStorage.getItem('brg-plan:v1:bordeaux-moxy')),null);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.setViewportSize({width:390,height:1000});await page.screenshot({path:'artifacts/claim-plan-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'artifacts/claim-plan-desktop.png',fullPage:true});
  const changed=structuredClone(fixture);changed.config.stays.find(s=>s.id==='bordeaux-moxy').booked.total=100;
  await page.evaluate(()=>localStorage.setItem('brg-plan:v1:bordeaux-moxy',JSON.stringify({scope:'old',mode:'new',reservedAt:'invalid'})));
  await page.route('**/data.json*',r=>r.fulfill({json:changed}));await page.reload({waitUntil:'networkidle'});assert.match(await root.locator('.plan-eyebrow').innerText(),/새 예약 검토/);
  assert.deepEqual(dataRequests,[]);assert.deepEqual(errors,[]);
 }finally{await browser.close();server.kill('SIGTERM');}
});
test('a fully checked profitable actual reservation becomes ready, then loses readiness as the claim window expires',async()=>{
 const {stayScope}=await import('../site/rate-display.js');const {reservationScope}=await import('../site/claim-plan.js');
 const server=spawn(process.execPath,['src/server.mjs'],{stdio:'ignore',env:{...process.env,PORT:'4178'}}),browser=await chromium.launch();
 try{
  for(let i=0;i<30;i++){if((await fetch('http://127.0.0.1:4178/').catch(()=>null))?.ok)break;await new Promise(r=>setTimeout(r,100));}
  const data=structuredClone(fixture),s=data.config.stays[0],now=Date.now(),at=new Date(now).toISOString(),reservedAt=new Date(now-86400000+30000).toISOString();
  s.standardCheckInAt='2027-04-03T15:00:00+02:00';
  const official={status:'ok',prepaid:false,currency:'EUR',totalAmount:300,amountBasis:'pre-tax',checkIn:s.checkIn,checkOut:s.checkOut,adults:s.adults,capturedAt:at,lowestPublicRateVerified:true,comparable:true,availabilityVerified:true,approvedTaxRules:{verified:true,currency:'EUR',scope:reservationScope(s),checkedAt:at,appliesToReward:'discount',percent:.1,fixed:10,evidence:'Verified Marriott tax rules for selected offer'}};
  data.runs.push({capturedAt:at,results:[{id:s.id,status:'error',marriott:official}]});data.collectorStatus={capturedAt:at,results:[{id:s.id,status:'ok'}]};
  data.otaStatus={capturedAt:at,results:[{id:s.id,providers:[{provider:'Booking.com',scope:stayScope(s),status:'ok',capturedAt:at,currency:'EUR',amountBasis:'pre-tax',totalAmount:200,hotelMatched:true,roomContext:s.booked.room,checkIn:s.checkIn,checkOut:s.checkOut,adults:s.adults,children:0,rooms:1,cancellationPolicyMatched:true,inclusionsMatched:true,paymentPolicyMatched:true,publicRate:true,restrictionsChecked:true,availabilityVerified:true}]}]};
  const page=await browser.newPage();await page.clock.install({time:new Date(now)});
  await page.route('**/data.json*',r=>r.fulfill({json:data}));await page.goto('http://127.0.0.1:4178/',{waitUntil:'networkidle'});
  await page.evaluate(({id,scope,reservedAt})=>localStorage.setItem('brg-plan:v1:'+id,JSON.stringify({scope,mode:'new',reservedAt,reservedRoomAmount:300,bookingConfirmed:true})),{id:s.id,scope:reservationScope(s),reservedAt});await page.reload({waitUntil:'networkidle'});
  const root=page.locator(`[data-stay-id="${s.id}"] .claim-plan`);assert.equal(await root.locator('.claim-overview').getAttribute('data-plan-state'),'ready');assert.match(await root.locator('h3').innerText(),/두 조건 충족/);
  await root.locator('.plan-primary').click();await root.locator('.packet>summary').click();assert.match(await root.locator('textarea').inputValue(),/BRG 신청 준비/);
  await page.locator('h1').click();await page.clock.runFor(61000);
  assert.equal(await root.locator('.claim-overview').getAttribute('data-plan-state'),'closed');assert.match(await root.locator('textarea').inputValue(),/검토 초안/);assert.doesNotMatch(await root.locator('h3').innerText(),/두 조건 충족/);
 }finally{await browser.close();server.kill('SIGTERM');}
});

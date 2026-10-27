import fs from 'node:fs/promises';import path from 'node:path';import {chromium} from 'playwright';
import {collectMarriottRate} from '../src/marriott.mjs';import {inspectMarriottPrecision} from '../src/marriott-precision.mjs';import {verifyStay,mergeVerification} from '../src/brg-verifier.mjs';
const root=path.resolve(import.meta.dirname,'..'),endpoint=process.env.MARRIOTT_CDP_URL??process.env.OTA_CDP_URL;
if(!endpoint)throw new Error('전용 Chrome 수집 연결이 필요합니다.');
const config=JSON.parse(await fs.readFile(path.join(root,'config/stays.json'),'utf8')),ids=new Set((process.env.STAY_IDS??'').split(',').filter(Boolean));const stays=config.stays.filter(s=>!ids.size||ids.has(s.id));if(!stays.length)throw new Error('확인할 호텔이 없습니다.');
const browser=await chromium.connectOverCDP(endpoint,{timeout:15000,noDefaults:true}),context=browser.contexts()[0];
const file=path.join(root,'data/marriott-status.json');let status={results:[]};try{status=JSON.parse(await fs.readFile(file,'utf8'));}catch{}
let errors=0;
for(const stay of stays){
 console.log(`정밀 자동검증: ${stay.id}`);
 const official=await collectMarriottRate(context,stay,{rates:{[stay.booked.currency]:1}},{ownedPageOnly:true,browser:{authMethod:'cdp-profile',browserVersion:browser.version(),persistent:true,headless:false},inspectRate:inspectMarriottPrecision});
 const verification=await verifyStay(context,stay,official);status=mergeVerification(status,[{id:stay.id,verification}]);await fs.writeFile(file,JSON.stringify(status,null,2)+'\n');
 console.log(JSON.stringify({id:stay.id,official:verification.official.state,offers:verification.offers.map(o=>({provider:o.provider,state:o.state,preTax:o.facts?.price?.preTaxAmount,cancelDeadline:o.facts?.cancellation?.freeUntil})),checks:verification.comparisons.map(c=>({provider:c.provider,state:c.state,unknown:c.unknown,mismatches:c.mismatches}))}));
 if(official.status!=='ok'||verification.offers.some(o=>o.status==='error'))errors++;
}
console.log(`정밀검증 ${stays.length}건 종료, 조회 오류 ${errors}건. 부분 확인은 적격 확정이 아닙니다.`);
// Disconnect this CLI only; every collector closes its own pages. No booking mutation.
process.exit(errors?2:0);

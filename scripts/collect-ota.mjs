import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {collectOtaChecks} from '../src/ota.mjs';
import {mergeOtaAttempts} from '../src/ota-status.mjs';
import {reviewProviders} from '../site/brg.js';
const root=path.resolve(import.meta.dirname,'..');
if(!process.env.OTA_CDP_URL)throw new Error('전용 Chrome OTA_CDP_URL 설정이 필요합니다.');
const config=JSON.parse(await fs.readFile(path.join(root,'config/stays.json'),'utf8'));
const ids=new Set((process.env.STAY_IDS??'').split(',').filter(Boolean));
const stays=config.stays.filter(s=>!ids.size||ids.has(s.id));
const providers=process.env.OTA_PROVIDERS?process.env.OTA_PROVIDERS.split(','):reviewProviders;
if(!stays.length||!providers.length||providers.some(x=>!reviewProviders.includes(x)))throw new Error('잘못된 호텔/판매처 선택입니다.');
let browser;
try{browser=await chromium.connectOverCDP(process.env.OTA_CDP_URL,{timeout:20000,noDefaults:true});}
catch{console.error('전용 Chrome 자동화 연결 초기화 실패 (연결 주소는 출력하지 않습니다).');process.exit(2);}
const context=browser.contexts()[0];
const results=[];
for(const stay of stays){
 console.log(`OTA checking: ${stay.id}`);
 results.push({id:stay.id,state:'direct-attempted',providers:await collectOtaChecks(context,null,stay,context,{providers})});
}
const file=path.join(root,'data/ota-status.json');let previous={results:[]};
try{previous=JSON.parse(await fs.readFile(file,'utf8'));}catch{}
await fs.writeFile(file,JSON.stringify(mergeOtaAttempts(previous,{capturedAt:new Date().toISOString(),results}),null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({id:r.id,providers:r.providers.map(x=>({provider:x.provider,status:x.status,state:x.state,roomAmount:x.roomAmount}))})),null,2));
// Disconnect this client only. Collector-owned pages were closed in finally.
process.exit(results.some(r=>r.providers.some(x=>x.status==='error'))?2:0);

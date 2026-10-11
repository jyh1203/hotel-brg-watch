import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {readDedicatedOtaTabs} from '../src/ota.mjs';
const root=path.resolve(import.meta.dirname,'..');
if(!process.env.OTA_CDP_URL)throw new Error('OTA_CDP_URL에 전용 Chrome 연결 주소를 지정하세요. 일반 Chrome 프로필은 사용하지 않습니다.');
const config=JSON.parse(await fs.readFile(path.join(root,'config/stays.json'),'utf8'));
const requested=new Set((process.env.STAY_IDS??'').split(',').filter(Boolean));
const stays=requested.size?config.stays.filter(s=>requested.has(s.id)):config.stays;
if(!stays.length)throw new Error('일치하는 호텔이 없습니다.');
const browser=await chromium.connectOverCDP(process.env.OTA_CDP_URL,{timeout:15000});
const results=[];
for(const stay of stays)results.push({id:stay.id,state:'dedicated-tabs-read',providers:await readDedicatedOtaTabs(browser,stay)});
let previous={results:[]};
const file=path.join(root,'data/ota-status.json');
try{previous=JSON.parse(await fs.readFile(file,'utf8'));}catch{}
const ids=new Set(results.map(x=>x.id));
await fs.writeFile(file,JSON.stringify({capturedAt:new Date().toISOString(),results:[...(previous.results??[]).filter(x=>!ids.has(x.id)),...results]},null,2)+'\n');
console.log(JSON.stringify(results,null,2));
// Do not close the user's browser or tabs. Terminate only this CLI transport.
process.exit(0);

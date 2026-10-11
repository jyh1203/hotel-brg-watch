import {reviewProviders, providerName, candidateEvidence, roomOnlyFromBreakdown} from '../site/brg.js';
import {setBookingSearch,setAgodaSearch,openExpediaObservedSearch,parseOccupancy} from './ota-search.mjs';
import {readSelectedBookingOffer} from './ota-booking.mjs';
import {otaScope} from './ota-status.mjs';

const domains = { 'Booking.com': ['booking.com'], Agoda: ['agoda.com'], Expedia: ['expedia.com','expedia.co.kr','expedia.co.uk','expedia.fr','expedia.es','expedia.de','expedia.ca'] };
export function belongsToProvider(value, provider) {
  try { const u=new URL(value); return u.protocol==='https:' && domains[provider]?.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)); } catch {return false;}
}
export function allowedOutbound(value, provider) {
  if (belongsToProvider(value,provider)) return true;
  try { const u=new URL(value);return u.protocol==='https:' && u.hostname==='www.google.com' && /^\/(?:travel\/clk|aclk|url)$/.test(u.pathname); }catch{return false;}
}
export function otaPageState(text) {
  if (/captcha|access denied|unusual traffic|show us your human side|verify (?:that )?you(?:'re| are) human|robot check|보안 확인/i.test(text)) return 'blocked';
  if (!String(text).trim()) return 'empty-page';
  return null;
}

const labelSets = {
 'Booking.com': {room:/^(?:Room price|Room subtotal|Accommodation subtotal|객실 요금|객실료)$/i,total:/^(?:Total|Total price|총액|총 요금)$/i},
 Agoda: {room:/^(?:Room price|Room subtotal|Subtotal|객실 요금|소계)$/i,total:/^(?:Total|Total price|Grand total|총액|총 요금)$/i},
 Expedia: {room:/^(?:Room price|Room subtotal|Subtotal|객실 요금|소계)$/i,total:/^(?:Total|Total price|Trip total|총액|총 요금)$/i}
};
// Only a scoped, visible price-details panel may supply these lines. Do not
// aggregate amounts from the hotel page, other rooms or recommendations.
export function parseOtaPriceDetails(lines, provider, currency) {
  const labels=labelSets[provider]; if(!labels||!Array.isArray(lines))return null;
  const symbols={EUR:'€',JPY:'(?:¥|￥)',KRW:'₩',USD:'\\$'};
  const amountRe=new RegExp(`(?:${currency}|${symbols[currency]??'(?!)'})\\s*([\\d,]+(?:\\.\\d{1,2})?)`,'i');
  const records=[];
  for(let i=0;i<lines.length;i++){
    const text=String(lines[i]).trim();let m=text.match(amountRe);
    if(m){const label=text.slice(0,m.index).replace(/[:：]\s*$/,'').trim();if(label)records.push({label,amount:Number(m[1].replaceAll(',',''))});continue;}
    const next=String(lines[i+1]??'').trim().match(amountRe);
    if(next&&/^(?:EUR|USD|JPY|KRW|€|¥|￥|₩|\$)/i.test(String(lines[i+1]).trim())){records.push({label:text,amount:Number(next[1].replaceAll(',',''))});i++;}
  }
  const room=records.filter(x=>labels.room.test(x.label));const total=records.filter(x=>labels.total.test(x.label));
  if(room.length!==1||total.length!==1||room[0].amount<=0)return null;
  const charges=[];
  for(const item of records){
    if(labels.room.test(item.label)||labels.total.test(item.label))continue;
    if(!/tax|fee|gratuity|tip|세금|수수료|봉사료|팁/i.test(item.label))return null;
    if(/discount|credit|할인|크레딧/i.test(item.label))return null;
    const outside=/not included|excluded|별도|불포함/i.test(item.label);
    const inside=/included|포함/i.test(item.label)&&!outside;
    const property=/property|hotel|현장|호텔/i.test(item.label);
    if(property&&!outside&&!inside)return null;
    charges.push({kind:/gratuity|tip|팁/i.test(item.label)?'gratuity':/tax|세금/i.test(item.label)?'tax':'fee',amount:item.amount,currency,
      includedInDisplayedTotal:outside?false:true,paidAt:property?'property':/online|온라인/i.test(item.label)?'online':'unspecified'});
  }
  // A room subtotal plus an explicit tax/fee line must reconcile exactly.
  // No tax-rate inference and no assumption that absent charges mean zero.
  if(!charges.length)return null;
  const priceBreakdown={currency,displayedTotal:total[0].amount,verified:true,nonRoomChargesComplete:true,charges};
  const calculated=roomOnlyFromBreakdown(priceBreakdown,currency);
  const tolerance=currency==='JPY'?0:0.005;
  if(!calculated||Math.abs(calculated.roomAmount-room[0].amount)>tolerance)return null;
  return {priceBreakdown,roomAmount:calculated.roomAmount,knownPayableTotal:calculated.knownPayableTotal};
}

export function validateOtaSnapshot(snapshot, stay, provider) {
  const block=otaPageState(snapshot.text);if(block)return {state:block,status:'error'};
  if(!belongsToProvider(snapshot.url,provider))return {state:'unexpected-destination',status:'error'};
  // Public property pages may append the brand suffix; never strip room,
  // location or other hotel-name words to force a match.
  const normalize=value=>String(value??'').normalize('NFKC').replace(/\s+by Marriott\s*$/i,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const hotel=normalize(snapshot.hotel);
  const expected=[stay.hotel,...(stay.ota?.hotelAliases?.[provider]??[])].map(normalize);
  if(!hotel||!expected.includes(hotel))return {state:'hotel-unverified',status:'pending'};
  const dates=[...new Set(snapshot.dates??[])].sort();
  if(dates.length!==2||dates[0]!==stay.checkIn||dates[1]!==stay.checkOut||snapshot.adults!==stay.adults||snapshot.children!==0||snapshot.rooms!==1)
    return {state:'search-conditions-unverified',status:'pending'};
  const evidence=candidateEvidence(stay,{context:snapshot.room??'',freeCancellation:snapshot.freeCancellation===true,cancellationDeadline:snapshot.cancellationDeadline});
  if(!evidence.roomMatched||!evidence.cancellationMatched)return {state:'room-or-cancellation-unverified',status:'pending'};
  if(snapshot.publicRate!==true)return {state:'public-rate-unverified',status:'pending'};
  const price=parseOtaPriceDetails(snapshot.priceLines,provider,stay.booked.currency);
  if(!price)return {state:'price-breakdown-unverified',status:'pending'};
  // A price-details dialog alone is not proof of a selected, bookable offer.
  if(snapshot.selectedOffer!==true)return {state:'selected-offer-unverified',status:'pending'};
  return {status:'ok',state:'room-price-verified',currency:stay.booked.currency,...price,
    roomContext:snapshot.room,cancellationDeadline:snapshot.cancellationDeadline,
    publicRate:true,availabilityVerified:false,priceBasis:snapshot.priceBasis??'scoped-price-details',
    searchEvidence:{checkIn:dates[0],checkOut:dates[1],adults:snapshot.adults,children:snapshot.children,rooms:snapshot.rooms}};
}

export async function readGoogleOtaLinks(page) {
  const links=await page.evaluate(()=>[...document.querySelectorAll('a[href]')].flatMap(a=>{
    if(!a.getBoundingClientRect().width)return [];
    let n=a;
    for(let depth=0;depth<7&&n;depth++,n=n.parentElement){
      const text=n.innerText??'';
      // Rate cards begin with a provider; nearby hotel recommendations do not.
      const match=text.trim().match(/^(Booking\.com|Agoda(?:\.com)?|Expedia(?:\.(?:co\.kr|co\.uk|com|fr|es|de|ca))?)(?=\s|Free|€|¥|₩|$)/i);
      if(match && /Visit site/i.test(text) && text.length<1400)return [{provider:match[1],href:a.href}];
    }
    return [];
  }));
  return reviewProviders.flatMap(provider=>{
    const link=links.find(x=>providerName(x.provider)===provider&&allowedOutbound(x.href,provider));
    return link?[{provider,href:link.href}]:[];
  });
}

export async function readOtaSnapshot(page, provider) {
  const snapshot=await page.evaluate(()=>{
    const visible=n=>Boolean(n?.getBoundingClientRect().width);
    const firstText=selector=>[...document.querySelectorAll(selector)].filter(visible).map(n=>n.innerText?.trim()).find(Boolean)??'';
    const text=document.body.innerText;
    const dates=[...document.querySelectorAll('input[type=date],input[name=checkin],input[name=checkout],[data-testid="date-display-field-start"],[data-testid="date-display-field-end"]')]
      .filter(visible).map(n=>n.value||n.getAttribute('aria-label')||n.innerText).flatMap(x=>String(x).match(/20\d{2}-\d{2}-\d{2}/g)??[]);
    const occupancy=firstText('[data-testid="occupancy-config"],[data-testid="occupancy-summary"],[data-testid="occupancy"]');
    const room=firstText('[data-testid="selected-room"],[data-testid="room-name"],[data-stid="room-name"]');
    const panel=firstText('[data-testid="price-summary"],[data-testid="price-breakdown"],[data-stid="price-summary"],[role="dialog"]');
    const selected=firstText('[data-testid="booking-summary"],[data-stid="booking-summary"],[data-testid="selected-room"]');
    return {text,hotel:firstText('h1'),dates,occupancy,room,priceLines:panel.split('\n'),selectedOffer:Boolean(selected)&&/price|total|요금|총액/i.test(selected)};
  });
  snapshot.url=page.url();
  Object.assign(snapshot,parseOccupancy(snapshot.occupancy));
  snapshot.freeCancellation=/free cancellation|무료\s*취소/i.test(snapshot.room);
  snapshot.cancellationDeadline=snapshot.room.match(/(?:until|before|기한)\s*(20\d{2}-\d{2}-\d{2})/i)?.[1]??null;
  // Explicit public-rate evidence only; absence of a member badge is not proof.
  snapshot.publicRate=/public rate|standard public price|일반 공개 요금/i.test(snapshot.room)&&!/member|genius|mobile|coupon|회원|쿠폰/i.test(snapshot.room);
  return snapshot;
}

export async function collectOtaChecks(context, googlePage, stay, otaContext = context, {providers=reviewProviders}={}) {
  let links=[];try{links=await readGoogleOtaLinks(googlePage);}catch{}
  const attempts=[];
  for(const provider of reviewProviders.filter(x=>providers.includes(x))){
    const configured=stay.ota?.urls?.[provider];
    const link=links.find(x=>x.provider===provider) ?? (belongsToProvider(configured,provider)?{provider,href:configured}:null);
    const base={provider,capturedAt:new Date().toISOString(),scope:otaScope(stay)};
    if(!link){attempts.push({...base,status:'pending',state:'link-unavailable'});continue;}
    const page=await otaContext.newPage();
    let stage='navigation';
    try{
      await page.goto(link.href,{waitUntil:'domcontentloaded',timeout:20000});
      await page.locator('body').waitFor({timeout:5000});
      await page.waitForFunction(()=>Boolean(document.body?.innerText.trim()),null,{timeout:8000}).catch(()=>{});
      const details=page.getByRole('button',{name:/^(?:Price details|Price breakdown|Taxes and fees|요금 상세|요금 내역|세금 및 수수료)$/i}).first();
      if(await details.isVisible().catch(()=>false))await details.click({timeout:3000});
      let snapshot=await readOtaSnapshot(page,provider);
      snapshot.text = `${await page.title()}\n${snapshot.text}`;
      let outcome=validateOtaSnapshot(snapshot,stay,provider);
      const fallback=stay.ota?.urls?.[provider];
      if(outcome.state==='hotel-unverified' && belongsToProvider(fallback,provider)){
        await page.goto(fallback,{waitUntil:'domcontentloaded',timeout:20000});
        await page.locator('h1').first().waitFor({timeout:5000}).catch(()=>{});
        snapshot=await readOtaSnapshot(page,provider);
        snapshot.text=`${await page.title()}\n${snapshot.text}`;
        outcome=validateOtaSnapshot(snapshot,stay,provider);
      }
      if(provider==='Booking.com'&&outcome.state==='search-conditions-unverified') {
        stage='search';
        const search=await setBookingSearch(page,stay);
        if(search.state==='search-set') {
          stage='room-selection';
          const offer=await readSelectedBookingOffer(page,stay,search);
          outcome=offer.snapshot?validateOtaSnapshot(offer.snapshot,stay,provider):{status:'pending',state:offer.state};
        } else outcome={status:'pending',state:search.state};
      }
      if(provider==='Agoda'&&outcome.state==='search-conditions-unverified') {
        stage='search';
        const search=await setAgodaSearch(page,stay);
        if(search.state==='search-set'){
          stage='room-selection';
          await page.getByRole('heading',{name:'Select your room',exact:true}).scrollIntoViewIfNeeded({timeout:8000});
          snapshot=await readOtaSnapshot(page,provider);
          Object.assign(snapshot,search);
          outcome=validateOtaSnapshot(snapshot,stay,provider);
        }else outcome={status:'pending',state:search.state};
      }
      if(provider==='Expedia'&&outcome.state==='search-conditions-unverified') {
        stage='search';
        const search=await openExpediaObservedSearch(page,stay);
        if(search.state==='blocked')outcome={status:'error',state:'blocked'};
        else if(search.state==='search-opened-unverified')outcome=validateOtaSnapshot(await readOtaSnapshot(page,provider),stay,provider);
        else outcome={status:'pending',state:search.state};
      }
      // No raw text, redirect query, cookies or personal checkout fields persist.
      attempts.push({...base,...outcome,sourceOrigin:belongsToProvider(page.url(),provider)?new URL(page.url()).origin:null});
    }catch(error){attempts.push({...base,status:'error',state:`${stage}-${error.name==='TimeoutError'?'timeout':'failed'}`});}
    finally{await page.close().catch(()=>{});}
  }
  return attempts;
}

// Explicit opt-in dedicated Chrome/CDP path. Read existing tabs only; never
// navigate, change a reservation form, submit guest details or book anything.
export async function readDedicatedOtaTabs(browser, stay) {
  const attempts=[];
  for(const provider of reviewProviders){
    const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>belongsToProvider(p.url(),provider));
    let best={provider,capturedAt:new Date().toISOString(),scope:otaScope(stay),status:'pending',state:'tab-unavailable'};
    for(const page of pages){
      try{
        const snapshot=await readOtaSnapshot(page,provider);
        snapshot.text=`${await page.title()}\n${snapshot.text}`;
        const outcome=validateOtaSnapshot(snapshot,stay,provider);
        if(outcome.state==='hotel-unverified')continue;
        best={provider,capturedAt:new Date().toISOString(),scope:otaScope(stay),...outcome,sourceOrigin:new URL(page.url()).origin};
        if(outcome.status==='ok')break;
      }catch{best={provider,capturedAt:new Date().toISOString(),status:'error',state:'tab-read-failed'};}
    }
    attempts.push(best);
  }
  return attempts;
}

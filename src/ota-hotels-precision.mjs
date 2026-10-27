import {parseExactCancellation,parseHotelsPrice,precisionScope} from './brg-precision.mjs';
const compact=s=>String(s??'').replace(/\s+/g,' ').trim();
const domain=url=>{try{const u=new URL(url);return u.protocol==='https:'&&/(^|\.)hotels\.com$/.test(u.hostname);}catch{return false;}};
export function hotelsSearchUrl(stay){
 const source=stay.ota?.precisionHotels;
 if(source?.propertyId){const u=new URL('https://kr.hotels.com/Hotel-Search');u.search=new URLSearchParams({selected:String(source.propertyId),startDate:stay.checkIn,endDate:stay.checkOut,adults:String(stay.adults),children:'',currency:stay.booked.currency});return u.href;}
 if(domain(source?.url)){const u=new URL(source.url);u.search=new URLSearchParams({chkin:stay.checkIn,chkout:stay.checkOut,rm1:Array(stay.adults).fill('a').join(''),currency:stay.booked.currency});return u.href;}
 return null;
}
export function readHotelsSelectedDates(){
 const cells=[...document.querySelectorAll('[role=dialog] [aria-selected=true],[role=dialog] [aria-pressed=true]')].filter(e=>e.getBoundingClientRect().width&&/^\d{1,2}$/.test(e.innerText?.trim()??''));
 const values=[];
 for(const cell of cells){
  const attrs=[cell,cell.querySelector('button'),cell.querySelector('[data-day]'),cell.querySelector('[aria-label]')].filter(Boolean).flatMap(e=>[e.getAttribute('data-day'),e.getAttribute('data-date'),e.getAttribute('aria-label')]);
  let date=attrs.map(v=>{const iso=v?.match(/20\d{2}-\d{2}-\d{2}/)?.[0];const ko=v?.match(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/);return iso??(ko?`${ko[1]}-${ko[2].padStart(2,'0')}-${ko[3].padStart(2,'0')}`:null);}).find(Boolean);
  if(!date){
   let node=cell;for(let depth=0;depth<7&&node;depth++,node=node.parentElement){
    const heading=node.querySelector('h2,h3,caption');const m=heading?.innerText?.match(/(20\d{2})년\s*(\d{1,2})월/);
    if(m){date=`${m[1]}-${m[2].padStart(2,'0')}-${cell.innerText.trim().padStart(2,'0')}`;break;}
   }
  }
  if(date)values.push(date);
 }
 const sorted=[...new Set(values)].sort();return sorted.length>=2?{checkIn:sorted[0],checkOut:sorted.at(-1)}:null;
}
function bedMatches(text,stay){
 const expected=stay.match?.bedPatterns??[];
 const normalized=text.replace(/퀸사이즈침대/g,' queen ').replace(/킹사이즈침대/g,' king ').replace(/더블침대/g,' double ').replace(/싱글침대/g,' single ');
 return expected.length>0&&expected.every(p=>new RegExp(p,'i').test(normalized))&&!(stay.match?.excludedPatterns??[]).some(p=>new RegExp(p,'i').test(normalized));
}
export async function collectHotelsPrecision(context,stay){
 const base={provider:'Hotels.com',scope:precisionScope(stay),capturedAt:new Date().toISOString()},url=hotelsSearchUrl(stay);
 if(!url)return {...base,status:'pending',state:'property-link-unavailable',facts:{}};
 const page=await context.newPage();page.setDefaultTimeout(7000);let stage='hotel-search',facts={},evidence={};
 try{
  await page.bringToFront();
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
  const block=await page.locator('body').innerText({timeout:4000});if(/captcha|access denied|verify you are human/i.test(block))return {...base,status:'error',state:'blocked',facts};
  const aliases=[stay.hotel,...(stay.ota?.hotelAliases?.['Hotels.com']??[])];
  const links=await page.locator('a[href]').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().width).map(e=>({text:e.innerText,href:e.href})));
  const target=links.find(a=>domain(a.href)&&!/Hotel-Search/.test(new URL(a.href).pathname)&&(aliases.some(n=>compact(a.text).toLowerCase().includes(n.toLowerCase()))||(stay.ota?.precisionHotels?.publicPropertyId&&new URL(a.href).pathname.startsWith('/ho'+stay.ota.precisionHotels.publicPropertyId+'/'))));
  if(target)await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:25000});
  const offers=page.locator('[data-stid^="property-offer-"]');await offers.first().waitFor({timeout:20000});
  const reject=page.getByRole('button',{name:'모두 거부',exact:true});if(await reject.isVisible().catch(()=>false))await reject.click();
  const headings=await page.locator('h1,h2').allTextContents();facts.hotelId=headings.some(h=>aliases.some(n=>compact(h).toLowerCase()===n.toLowerCase()))?stay.id:null;
  evidence.hotel=headings.filter(h=>aliases.some(n=>compact(h).toLowerCase()===n.toLowerCase()));
  const publicPage=new URL(page.url());evidence.propertyUrl=publicPage.origin+publicPage.pathname;
  // Read actual occupancy controls, including zero children, not URL defaults.
  stage='occupancy';const picker=page.locator('button[data-stid="open-room-picker"]').first();const pickerLabel=await picker.innerText();await picker.click();
  const adults=page.locator('input[aria-label="성인"]:visible').first(),children=page.locator('input[aria-label^="아동"]:visible').first();
  await adults.waitFor({timeout:4000});const occupancy={adults:Number(await adults.inputValue()),children:Number(await children.inputValue()),rooms:Number(pickerLabel.match(/객실\s*(\d+)개/)?.[1]??NaN)};
  await page.getByRole('button',{name:'완료',exact:true}).last().click();evidence.occupancy=occupancy;
  stage='calendar';const dateButton=page.getByRole('button').filter({hasText:new RegExp(`${Number(stay.checkIn.slice(5,7))}월 ${Number(stay.checkIn.slice(8))}일.*${Number(stay.checkOut.slice(5,7))}월 ${Number(stay.checkOut.slice(8))}일`)}).first();
  await dateButton.click();const calendar=page.locator('[role=dialog]:visible').last();await calendar.locator('[aria-selected=true],[aria-pressed=true]').nth(1).waitFor({timeout:5000}).catch(()=>{});
  const dates=await page.evaluate(readHotelsSelectedDates);evidence.dates=dates;
  const cancelDate=calendar.getByRole('button',{name:/취소, 변경 사항을 저장하지 않고/});if(await cancelDate.count())await cancelDate.click();else await page.keyboard.press('Escape');
  const searchVerified=dates?.checkIn===stay.checkIn&&dates?.checkOut===stay.checkOut&&occupancy.adults===stay.adults&&occupancy.children===(stay.children??0)&&occupancy.rooms===(stay.rooms??1);
  facts.search=searchVerified?{checkIn:dates.checkIn,checkOut:dates.checkOut,...occupancy}:null;
  stage='room-selection';let offer;
  for(let i=0;i<await offers.count();i++){const candidate=offers.nth(i),text=await candidate.innerText();if(bedMatches(text,stay)&&!/소파베드|sofa bed|harbo[u]?r|항구 전망/i.test(text)){offer=candidate;break;}}
  if(!offer)return {...base,capturedAt:new Date().toISOString(),status:'pending',state:'matching-bed-unavailable',facts,evidence};
  const text=await offer.innerText();evidence.roomText=text.slice(0,2400);facts.bedMatched=bedMatches(text,stay);
  // A generic Queen label is not automatically the named Marriott room.
  const named=(stay.match?.roomPatterns??[]).every(p=>new RegExp(p,'i').test(text));
  facts.roomIdentity=named&&facts.bedMatched?stay.booked.room:null;
  const refundable=offer.locator('label').filter({hasText:/전액 환불 가능/}).first(),noExtras=offer.locator('label').filter({hasText:/추가 없음/}).first();
  if(await refundable.count()!==1||await noExtras.count()!==1)return {...base,status:'pending',state:'refundable-room-only-option-unavailable',facts,evidence};
  await refundable.dispatchEvent('click');await noExtras.dispatchEvent('click');
  if(!await refundable.locator('input').isChecked()||!await noExtras.locator('input').isChecked())return {...base,status:'pending',state:'offer-selection-unconfirmed',facts,evidence};
  facts.inclusions={breakfast:false};
  stage='cancellation-policy';await offer.getByRole('button',{name:'모든 정책 옵션에 대한 세부 정보',exact:true}).click();
  const modal=page.locator('[role=dialog]:visible').last();await modal.getByText('전액 환불 가능',{exact:true}).first().click();
  const policy=await modal.innerText();evidence.cancellation=compact(policy);facts.cancellation=parseExactCancellation(policy,{year:Number(stay.checkIn.slice(0,4)),timeZone:stay.timeZone,datesVerified:searchVerified});
  await modal.getByRole('button',{name:'창 닫기',exact:true}).click();
  const selectedText=await offer.innerText();evidence.selectedText=selectedText.slice(0,2500);
  const signInShown=await page.getByRole('button',{name:'로그인',exact:true}).isVisible().catch(()=>false);
  stage='checkout';await offer.locator('[data-stid="submit-hotel-reserve"]').dispatchEvent('click');
  const pay=page.locator('[role=dialog]:visible').filter({hasText:'결제 옵션 선택'});await pay.waitFor({timeout:7000});const paymentText=await pay.innerText();
  const propertyPay=pay.locator('[data-stid="submit-hotel-reserve"]').filter({hasText:/^현장 결제$/});
  if(!paymentText.includes(`${stay.booked.currency} 통화로 숙박 시설에 직접 결제`)||!paymentText.includes('숙박하실 때까지 금액이 청구되지 않습니다')||await propertyPay.count()!==1)return {...base,status:'pending',state:'property-payment-unverified',facts,evidence};
  evidence.payment=compact(paymentText).slice(0,2200);facts.payment={timing:'property',guarantee:'card'};await propertyPay.dispatchEvent('click');
  const panel=page.locator('[data-stid="price-summary-card"]');await panel.waitFor({timeout:15000});const priceText=await panel.innerText();evidence.priceText=compact(priceText);facts.price=parseHotelsPrice(priceText,stay.booked.currency);
  const hotelHeadings=await page.locator('h1,h2').allTextContents();const checkoutHotel=hotelHeadings.some(h=>aliases.some(n=>compact(h).toLowerCase()===n.toLowerCase()));
  const guestForm=await page.getByRole('heading',{name:'체크인 고객 정보',exact:true}).count()>0;
  const finalControl=page.getByRole('button',{name:/지금.*예약하기/});await finalControl.first().waitFor({timeout:6000}).catch(()=>{});
  const finalAction=await finalControl.count()>0;
  const restricted=/회원 전용|회원가|회원 요금|Genius|로그인.*할인|쿠폰 적용|프로모션 적용|One Key.*할인/i.test(selectedText+' '+paymentText+' '+priceText);
  facts.restrictionsChecked=signInShown&&guestForm&&Boolean(facts.price);facts.publicRate=facts.restrictionsChecked?!restricted:null;
  facts.availabilityVerified=checkoutHotel&&guestForm&&finalAction&&Boolean(facts.price)&&searchVerified;
  // Never click finalAction or read/fill guest/card input values.
  const outcome={...base,capturedAt:new Date().toISOString(),status:'pending',state:facts.availabilityVerified?'selected-offer-observed':'checkout-evidence-partial',facts,evidence};
  return outcome;
 }catch(error){return {...base,capturedAt:new Date().toISOString(),status:'error',state:stage+'-'+(error.name==='TimeoutError'?'timeout':'failed'),facts,evidence};}
 finally{await page.close().catch(()=>{});}
}

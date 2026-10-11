import {candidateEvidence} from '../site/brg.js';
import {parseExplicitDates} from './ota-search.mjs';
export function normalizeBookingRoom(text) {
 return String(text).replaceAll('스탠다드','Standard').replaceAll('플러스','Plus').replaceAll('킹룸','King Room').replaceAll('퀸룸','Queen Room').replaceAll('트윈룸','Twin Room');
}
export function bookingCancellation(text) {
 const date=parseExplicitDates(text)[0];
 if(!date||!/무료\s*취소|free cancellation/i.test(text))return null;
 if(/전까지|before/i.test(text))return new Date(Date.parse(date)-86400000).toISOString().slice(0,10);
 return date;
}
export async function readSelectedBookingOffer(page,stay,search,{unauthenticated=false}={}) {
 const rows=await page.locator('.hprt-table tr').evaluateAll(ns=>ns.map((n,index)=>{
  const title=n.querySelector('.hprt-roomtype-icon-link')?.innerText?.trim()??n.querySelector('.hprt-roomtype-link')?.innerText?.trim();
  const select=n.querySelector('select[data-testid="select-room-trigger"]');
  return {index,title,text:n.innerText,selectable:!!select&&[...select.options].some(o=>o.value==='1'&&!o.disabled)};
 }));
 // Rowspan variants inherit a room label, but never another room's title.
 let title='';const offers=[];
 for(const row of rows){if(row.title)title=row.title;if(!row.selectable||!title)continue;
  const room=normalizeBookingRoom(title);const deadline=bookingCancellation(row.text);
  const evidence=candidateEvidence(stay,{context:room,freeCancellation:!!deadline,cancellationDeadline:deadline});
  if(!evidence.roomMatched||!evidence.cancellationMatched)continue;
  if(/plus|superior|deluxe|suite/i.test(room)&&!/plus|superior|deluxe|suite/i.test(stay.booked.room))continue;
  if(/조식 포함|breakfast included/i.test(row.text)&&!/breakfast|조식/.test(stay.booked.room))continue;
  offers.push({...row,room,deadline});
 }
 if(!offers.length)return {state:'matching-offer-unavailable'};
 const offer=offers[0];const row=page.locator('.hprt-table tr').nth(offer.index);
 await row.locator('select[data-testid="select-room-trigger"]').selectOption('1',{timeout:8000});
 const price=await row.evaluate(n=>{
  const cell=n.querySelector('.hprt-price-block');const charge=cell?.querySelector('[data-excl-charges-raw]');
  return {amount:cell?.querySelector('.bui-price-display__value')?.textContent?.trim(),chargeText:charge?.textContent?.trim(),chargeRaw:charge?.getAttribute('data-excl-charges-raw'),selected:n.querySelector('select')?.value==='1'};
 });
 const amount=Number(price.amount?.match(/€\s*([\d,.]+)/)?.[1]?.replaceAll(',',''));
 const charges=Number(price.chargeRaw);
 const guestPublic=unauthenticated===true||await page.locator('[data-testid="header-small-sign-in-button"]:visible,[data-testid="header-sign-in-button"]:visible').count()>0;
 const explicitExcluded=/^\+/.test(price.chargeText??'')&&/세금 및 기타 요금|taxes and charges|taxes and fees/i.test(price.chargeText??'');
 const currency=stay.booked.currency;
 if(currency!=='EUR'||!Number.isFinite(amount)||amount<=0||price.chargeRaw===null||!Number.isFinite(charges)||charges<0||!explicitExcluded)
  return {state:'price-breakdown-unverified'};
 // Displayed stay price is explicitly exclusive of the separate charge.
 // Do not invent a tax-inclusive observed total or a VAT percentage.
 return {state:'offer-read',snapshot:{url:page.url(),hotel:await page.locator('h1').first().innerText(),text:offer.text,
  ...search,room:offer.room,freeCancellation:true,cancellationDeadline:offer.deadline,
  publicRate:guestPublic&&!/Genius|member|mobile.only|쿠폰|회원 할인/i.test(offer.text),selectedOffer:price.selected,
  priceLines:[`Room price €${amount}`,`Taxes and fees not included €${Math.round(charges*100)/100}`,`Total €${amount}`],
  priceBasis:'explicit-room-subtotal',selectionOnly:true}};
}

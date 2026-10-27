import {readMarriottQuoteSnapshot,parseMarriottQuote} from './marriott-quote.mjs';
import {parseExactCancellation,precisionScope} from './brg-precision.mjs';
const compact=s=>String(s??'').replace(/\s+/g,' ').trim();
export function parseMarriottDetailedPrice(text,currency){
 const t=compact(text);
 // Explicit full-stay room/tax/final totals only; no unchecked-toggle inference.
 const amount='([\\d,]+(?:\\.\\d{1,2})?)';
 const room=t.match(new RegExp('(?:Room subtotal|Room charges|Room rate subtotal)\\s*'+amount+'\\s*'+currency,'i'));
 const tax=t.match(new RegExp('(?:Taxes and fees|Total taxes and fees)\\s*'+amount+'\\s*'+currency,'i'));
 const total=t.match(new RegExp('(?:Total for stay|Total stay amount|Grand total)\\s*'+amount+'\\s*'+currency,'i'));
 if(!room||!tax||!total||!/All rates are quoted exclusive of VAT\./i.test(t))return null;
 const num=m=>Number(m[1].replaceAll(',',''));if(Math.abs(num(room)+num(tax)-num(total))>.005)return null;
 return {currency,preTaxVerified:true,preTaxAmount:num(room),totalAmount:num(total),taxesAndFees:num(tax),amountBasis:'pre-tax'};
}

export function markFlexibleMemberDetails(root){
 const scope=root?.querySelectorAll?root:document;
 const target=root?.matches?.('button[aria-label="Select Flexible Rate Member Rate"]')?root:[...scope.querySelectorAll('button[aria-label]')].find(e=>e.getBoundingClientRect().width&&e.getAttribute('aria-label')==='Select Flexible Rate Member Rate');
 let node=target?.parentElement;
 for(let depth=0;depth<12&&node;depth++,node=node.parentElement){
  const controls=[...node.querySelectorAll('button[aria-label^="Select "]')];
  const links=[...node.querySelectorAll('a[data-testid="rate-modal"]')];
  if(!links.length)continue;
  if(controls.length===links.length&&controls.every(b=>/^Select Flexible Rate (?:Non-)?Member Rate$/i.test(b.getAttribute('aria-label')??''))){
   const index=controls.indexOf(target);if(index>=0){links[index].setAttribute('data-brg-flexible-details','selected');return true;}
  }
  if(controls.some(b=>!/Select Flexible Rate /i.test(b.getAttribute('aria-label')??'')))return false;
 }
 return false;
}

export async function inspectMarriottPrecision({page,card,rate,stay,observedDates,observedGuests}){
 const capturedAt=new Date().toISOString();const cardText=await card.innerText(),facts={},evidence={rateCard:cardText.slice(0,11000)};
 const headings=await page.locator('h1,h2').allTextContents();const title=await page.title();
 const visibleHotel=await page.getByText(new RegExp('^'+stay.hotel.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i')).first().isVisible().catch(()=>false);
 facts.hotelId=visibleHotel||headings.some(h=>compact(h).toLowerCase()===stay.hotel.toLowerCase())||title.toLowerCase().includes(stay.hotel.toLowerCase())?stay.id:null;
 const scopeVerified=observedDates?.checkIn===stay.checkIn&&observedDates?.checkOut===stay.checkOut&&observedGuests?.adults===stay.adults&&observedGuests?.children===(stay.children??0)&&observedGuests?.rooms===(stay.rooms??1);
 facts.search=scopeVerified?{...observedDates,...observedGuests}:null;evidence.selectedDates=observedDates;evidence.selectedGuests=observedGuests;
 const named=(stay.match?.roomPatterns??[]).every(p=>new RegExp(p,'i').test(rate.room))&&(stay.match?.bedPatterns??[]).every(p=>new RegExp(p,'i').test(rate.room))&&!(stay.match?.excludedPatterns??[]).some(p=>new RegExp(p,'i').test(rate.room));
 facts.roomIdentity=named?stay.booked.room:null;
 const flexible=cardText.match(/Flexible Rate([\s\S]*?)(?=Prepay|Stay for Breakfast Rate|$)/i)?.[1]??'';
 // Lowest member/public price within the selected flexible, same-inclusions section.
 const totals=[...flexible.matchAll(/([\d,.]+)\s+Total Per Room/g)].map(m=>Number(m[1].replaceAll(',','')));
 const refundableAmounts=[...cardText.matchAll(/Free cancellation[^\n]*[\s\S]*?(?:Member|Package) Rate\s+[^\n]*\n([\d,.]+) Total Per Room/g)].map(m=>Number(m[1].replaceAll(',','')));
 facts.lowerRefundableDisplayAmounts=refundableAmounts.filter(n=>n<rate.totalAmount);
 facts.lowestPublicRateVerified=totals.length>=1&&Math.min(...totals)===rate.totalAmount&&facts.lowerRefundableDisplayAmounts.length===0;
 facts.availabilityVerified=false; // Confirm only after the selected quote renders on reviewDetails.
 let details='';
 const requests=[];const observe=async response=>{try{const u=new URL(response.url());if(/(^|\.)marriott\.com$/.test(u.hostname)&&/PhoenixBookDTTGetRateDetails$/i.test(u.pathname))requests.push({path:u.pathname,status:response.status()});}catch{}};page.on('response',observe);
 try{
  await page.bringToFront();const chosen=card.getByRole('button',{name:'Select Flexible Rate Member Rate',exact:true}).first();if(!await chosen.evaluate(markFlexibleMemberDetails))throw new Error('selected-plan-details-unbound');
  const anchor=card.locator('a[data-brg-flexible-details="selected"]').first();
  await anchor.dispatchEvent('click');const panel=page.locator('#rateDetailsContent:visible').first();await panel.waitFor({timeout:5000});await page.waitForFunction(()=>[...document.querySelectorAll('#rateDetailsContent')].some(e=>e.getBoundingClientRect().width&&/cancel|guarantee|cancellation/i.test(e.innerText)&&e.innerText.length>80),null,{timeout:12000});details=await panel.innerText();
  const matchingPolicy=/Member Rate Flexible|Member Flexible Rate/i.test(compact(details))&&!/Member Rate Stay Longer/i.test(compact(details));
  if(!matchingPolicy){evidence.policyState='different-rate-plan';details='';}
  evidence.policyText=compact(details).slice(0,10000);
  const modal=page.locator('[aria-describedby="rateDetailsContent"]:visible').first();await modal.getByTestId('close-button').dispatchEvent('click').catch(()=>{});
 }catch{evidence.policyState='details-unavailable';}
 page.off('response',observe);evidence.policyRequests=requests;
 facts.cancellation=parseExactCancellation(details,{year:Number(stay.checkIn.slice(0,4)),timeZone:stay.timeZone,datesVerified:observedDates?.checkIn===stay.checkIn&&observedDates?.checkOut===stay.checkOut});
 facts.payment=/credit card (?:is )?required[^.]*guarantee|guarantee[^.]*credit card/i.test(details)&&/pay (?:at|upon)|upon (?:arrival|check-in)|at (?:the )?hotel|during your stay/i.test(details)?{timing:'property',guarantee:'card'}:null;
 facts.inclusions=/room only|no meals|breakfast (?:is )?not included/i.test(details)?{breakfast:false}:/includes breakfast|breakfast included/i.test(details)?{breakfast:true}:null;
 facts.price=parseMarriottDetailedPrice(details,stay.booked.currency);
 try{
  // Select only the observed flexible member quote. This is not the final booking action.
  const modal=page.locator('[aria-describedby="rateDetailsContent"]:visible').first();
  if(await modal.count())await modal.getByTestId('close-button').dispatchEvent('click').catch(()=>{});
  const select=card.getByRole('button',{name:'Select Flexible Rate Member Rate',exact:true}).first();
  await select.click({timeout:8000});
  await page.waitForURL(/\/reservation\/reviewDetails\.mi/,{timeout:18000});
  await page.waitForFunction(()=>/TOTAL FOR STAY[\s\S]*[\d,.]+\s*[A-Z]{3}/.test(document.body?.innerText??''),null,{timeout:15000});
  const summaryHeading=page.getByRole('heading',{name:'Summary of Charges',exact:true});
  if(!await summaryHeading.isVisible().catch(()=>false)){const toggle=page.getByRole('button',{name:'Total for Stay',exact:true});if(await toggle.isVisible().catch(()=>false))await toggle.dispatchEvent('click');}
  await summaryHeading.waitFor({timeout:5000}).catch(()=>{});
  const quote=await page.evaluate(readMarriottQuoteSnapshot);
  const roomMatches=quote.room&&(stay.match?.roomPatterns??[]).every(p=>new RegExp(p,'i').test(quote.room))&&(stay.match?.bedPatterns??[]).every(p=>new RegExp(p,'i').test(quote.room))&&!(stay.match?.excludedPatterns??[]).some(p=>new RegExp(p,'i').test(quote.room));
  evidence.checkoutRoom=quote.room;
  if(!roomMatches){facts.availabilityVerified=false;facts.checkoutRoomMismatch=Boolean(quote.room);facts.roomIdentity=null;evidence.quoteState=quote.room?'checkout-room-mismatch':'checkout-room-unverified';}
  else{
   facts.availabilityVerified=true;
   evidence.quotePriceLines=quote.priceLines;evidence.vatStatement=quote.vatStatement;
   facts.priceObserved=parseMarriottQuote(quote,stay);if(facts.priceObserved?.preTaxVerified)facts.price=facts.priceObserved;
  }
 }catch{evidence.quoteState='quote-details-unavailable';}

 const precisionObservation={provider:'Marriott',scope:precisionScope(stay),capturedAt,status:'pending',state:details?'detailed-policy-observed':'rate-card-observed',facts,evidence};
 return {precisionObservation,amountBasis:facts.price?.preTaxVerified?'pre-tax':'unknown',taxesIncluded:facts.price?.preTaxVerified?false:null,...(facts.price?.preTaxVerified?{totalAmount:facts.price.preTaxAmount}:{}),preTaxVerified:facts.price?.preTaxVerified===true};
}

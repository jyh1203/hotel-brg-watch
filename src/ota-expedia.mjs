import {parseExplicitDates} from './ota-search.mjs';

// A user-supplied checkout session can expose the payable currency separately
// from an FX-estimated breakdown. Never derive EUR room/tax amounts from KRW.
export function parseExpediaCheckoutObservation(snapshot,stay) {
 let url;try{url=new URL(snapshot.url);}catch{return null;}
 if(url.protocol!=='https:'||!['www.expedia.com','www.expedia.co.kr'].includes(url.hostname)||!url.pathname.startsWith('/checkout/'))return null;
 const compact=x=>String(x??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const hotels=[stay.hotel,...(stay.ota?.hotelAliases?.Expedia??[])];
 if(![snapshot.hotel,...(snapshot.hotelHeadings??[])].some(hotel=>hotels.some(x=>compact(x)===compact(hotel))))return null;
 const dates=parseExplicitDates(snapshot.dateText).sort();
 if(dates.length!==2||dates[0]!==stay.checkIn||dates[1]!==stay.checkOut)return null;
 const panel=String(snapshot.pricePanel??'');
 // Require an explicit payable EUR total in this scoped summary, not a nightly
// quote elsewhere, and explicit tax + total labels before recording all-in.
 const amounts=[...panel.matchAll(/\bEUR\s+([\d,]+\.\d{2})\b/g)].map(x=>Number(x[1].replaceAll(',','')));
 if(stay.booked.currency!=='EUR'||amounts.length!==1||amounts[0]<=0||!/(?:세금|Taxes)/i.test(panel)||!/(?:총 금액|Total)/i.test(panel))return null;
 const room=String(snapshot.room??'');
 return {state:'checkout-total-observed',currency:'EUR',totalAmount:amounts[0],amountBasis:'tax-included',
  sourceOrigin:new URL(snapshot.url).origin,checkIn:dates[0],checkOut:dates[1],
  roomContext:room,adults:snapshot.adults??null,children:snapshot.children??null,rooms:snapshot.rooms??null,
  cancellationText:snapshot.cancellationText??null,paymentTiming:/숙박 시설에서 결제|Pay at (?:the )?property/i.test(panel)?'property':'unverified',
  roomAmount:null,preTaxVerified:false,availabilityVerified:false,publicRateVerified:false};
}
// Shared DOM read for Playwright and the single-target CDP reader. Never read
// inputs, guest details, payment fields, cookies or network request bodies.
export function expediaCheckoutSnapshot() {
 const panel=document.querySelector('[data-stid="price-summary-card"]');
 if(!panel)return null;
 const text=document.body.innerText;
 const lines=text.split('\n').map(x=>x.trim());
 const dates=lines.filter(x=>/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+[A-Za-z]+\s+\d+,\s+20\d{2}$/.test(x));
 const get=re=>lines.find(x=>re.test(x));
 return {url:location.href,hotel:document.querySelector('h1')?.innerText,hotelHeadings:[...document.querySelectorAll('h1,h2,h3')].map(n=>n.innerText),pricePanel:panel.innerText,dateText:dates.join(' '),
  room:get(/^(?:스탠다드룸|Standard Room)/i),adults:Number(get(/^\d+ adults$/i)?.match(/^\d+/)?.[0])||null,
  rooms:Number(get(/^\d+ nights, \d+ room/i)?.match(/, (\d+) room/i)?.[1])||null,
  cancellationText:get(/^Fully refundable/i)};
}
export async function readExpediaCheckoutObservation(page,stay) {
 const snapshot=await page.evaluate(expediaCheckoutSnapshot);
 return snapshot?parseExpediaCheckoutObservation(snapshot,stay):null;
}

// Only offer-option selection and the uncommitted preview transitions are allowed.
// No final checkout controls, guest inputs or payment fields are accessed.
export function expediaPreviewAction(action) {
 const visible=n=>Boolean(n?.getBoundingClientRect().width);
 if(action==='property-payment') {
  const dialog=[...document.querySelectorAll('[role="dialog"]')].find(n=>visible(n)&&/Your payment options/.test(n.innerText));
  if(!dialog||!/You will not be charged until your stay/.test(dialog.innerText)||!dialog.innerText.includes('preferred currency (EUR)'))return false;
  const buttons=[...dialog.querySelectorAll('[data-stid="submit-hotel-reserve"]')].filter(n=>visible(n)&&n.innerText.trim()==='Pay at property');
  if(buttons.length!==1)return false;
  buttons[0].click();return true;
 }
 const headings=[...document.querySelectorAll('h2,h3,h4')].filter(n=>visible(n)&&n.innerText.trim()==='Standard Room, 1 King Bed');
 if(headings.length!==1)return false;
 let card=headings[0];
 while(card&&!/You will not be charged yet/.test(card.innerText))card=card.parentElement;
 if(!card||!/^property-offer-\d+$/.test(card.getAttribute('data-stid')??''))return false;
 const labels=[...card.querySelectorAll('label')];
 const policy=labels.filter(n=>/Reserve now, pay later/.test(n.innerText)&&/Fully refundable/.test(n.innerText));
 const extras=labels.filter(n=>/^No extras/.test(n.innerText.trim()));
 if(policy.length!==1||extras.length!==1)return false;
 if(action==='options'){policy[0].click();extras[0].click();return true;}
 if(action!=='room-preview'||!policy[0].querySelector('input[type="radio"]')?.checked||!extras[0].querySelector('input[type="radio"]')?.checked)return false;
 const buttons=[...card.querySelectorAll('[data-stid="submit-hotel-reserve"]')].filter(n=>visible(n)&&/^Select(?:\s+Select)?$/.test(n.innerText.trim()));
 if(buttons.length!==1)return false;
 buttons[0].scrollIntoView({block:'center'});buttons[0].click();return true;
}

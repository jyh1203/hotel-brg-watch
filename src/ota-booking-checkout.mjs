import {parseExplicitDates,parseOccupancy} from './ota-search.mjs';
import {normalizeBookingRoom} from './ota-booking.mjs';
export function bookingCheckoutSnapshot(){
 const price=document.querySelector('#bp-price-summary');if(!price)return null;
 const lines=document.body.innerText.split('\n').map(x=>x.trim());
 return {origin:location.origin,path:location.pathname,
  hotel:[...document.querySelectorAll('h1,h2,h3')].map(n=>n.innerText).find(x=>/Carlton|칼튼/i.test(x)),
  dates:lines.filter(x=>/^(?:20\d{2}년\s*\d{1,2}월\s*\d{1,2}일|[A-Za-z]+,?\s+\d{1,2}\s+[A-Za-z]+\s+20\d{2})/.test(x)).join(' '),
  occupancy:lines.find(x=>/\d+박, 객실 \d+개, 성인 \d+명/.test(x)),
  room:lines.find(x=>/^(?:스탠다드 킹룸|Standard King Room)(?:\s*x\s*1)?$/.test(x)),
  cancellationText:lines.find(x=>/20\d{2}.*(?:무료 취소|free cancellation)/i.test(x)),pricePanel:price.innerText};
}
export function parseBookingCheckoutObservation(snapshot,stay){
 if(!snapshot||snapshot.origin!=='https://secure.booking.com'||snapshot.path!=='/book.html'||stay.booked.currency!=='EUR')return null;
 const normalize=x=>String(x??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 if(![stay.hotel,...(stay.ota?.hotelAliases?.['Booking.com']??[])].some(x=>normalize(x)===normalize(snapshot.hotel)))return null;
 const dates=parseExplicitDates(snapshot.dates).sort();const occupancy=parseOccupancy(snapshot.occupancy);
 if(dates.length!==2||dates[0]!==stay.checkIn||dates[1]!==stay.checkOut||occupancy.adults!==stay.adults||occupancy.rooms!==1)return null;
 const room=normalizeBookingRoom(snapshot.room);if(!/standard/i.test(room)||!/king/i.test(room)||/plus|queen|twin/i.test(room))return null;
 const panel=snapshot.pricePanel;
 // The scoped panel explicitly labels the base amount and the separate charge.
 // Never infer a VAT amount from the percentage or URL parameters.
 const bases=[...panel.matchAll(/(?:금액|Price)\s*€\s*([\d,]+(?:\.\d{1,2})?)/gi)];
 const base=bases[0];
 const taxes=[...panel.matchAll(/\+\s*(?:세금 및 기타 요금|taxes and (?:charges|fees))\s*\(€\s*([\d,]+(?:\.\d{1,2})?)\)/gi)];
 const tax=taxes[0];
 if(bases.length!==1||taxes.length!==1||!/(?:별도|excluded|not included)/i.test(panel))return null;
 const amount=x=>Number(x.replaceAll(',',''));const roomAmount=amount(base[1]),taxAmount=amount(tax[1]);
 if(roomAmount<=0||taxAmount<0)return null;
 return {state:'checkout-total-observed',currency:'EUR',roomAmount,taxesAndFees:taxAmount,totalAmount:Math.round((roomAmount+taxAmount)*100)/100,amountBasis:'tax-included',totalBasis:'explicit-room-plus-excluded-charges',preTaxVerified:true,availabilityVerified:false,publicRateVerified:false,sourceOrigin:snapshot.origin,checkIn:dates[0],checkOut:dates[1],roomContext:room,adults:occupancy.adults,children:null,rooms:occupancy.rooms,cancellationText:snapshot.cancellationText??null,paymentTiming:'unverified',discovery:'user-opened-checkout'};
}

import {assertPublicVerification} from './marriott-quote.mjs';
import {collectHotelsPrecision} from './ota-hotels-precision.mjs';
import {comparePreciseFacts,precisionScope} from './brg-precision.mjs';
export async function verifyStay(context,stay,marriott,{now=Date.now()}={}){
 const official=marriott?.precisionObservation??{provider:'Marriott',scope:precisionScope(stay),capturedAt:new Date(now).toISOString(),status:'pending',state:marriott?.status==='ok'?'rate-details-unverified':marriott?.diagnostics?.state??'official-unavailable',facts:{},evidence:{}};
 const rate=marriott?.status==='ok'?{status:'ok',room:marriott.room,rateName:marriott.rateName,currency:marriott.currency,totalAmount:marriott.totalAmount,amountBasis:official.facts?.price?.preTaxVerified?'pre-tax':'unknown',prepaid:marriott.prepaid,checkIn:marriott.checkIn,checkOut:marriott.checkOut,adults:marriott.adults,capturedAt:marriott.capturedAt,freeCancellation:marriott.freeCancellation,sourceUrl:marriott.sourceUrl}:null;
 const offers=[await collectHotelsPrecision(context,stay)];
 const comparisons=offers.map(o=>({provider:o.provider,...comparePreciseFacts(stay,official,o)}));
 return assertPublicVerification({schemaVersion:1,scope:precisionScope(stay),capturedAt:new Date().toISOString(),official:{...official,rate},offers,comparisons});
}
export function mergeVerification(status,updates){
 const ids=new Set(updates.map(u=>u.id));
 return {...status,results:[...(status.results??[]).filter(r=>!ids.has(r.id)),...updates.map(update=>{const old=status.results?.find(r=>r.id===update.id);return {...old,id:update.id,status:old?.status??'not-collected',verification:update.verification};})]};
}

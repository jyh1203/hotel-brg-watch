import {reservationScope} from './claim-plan.js?v=20261027-precision-v1';
import {freshObservation} from './brg-readiness.js';
const positive=n=>Number.isFinite(n)&&n>0;
export function precisionFor(data,stay,now=Date.now()){
 const verification=data.collectorStatus?.results?.find(r=>r.id===stay.id)?.verification;
 if(!verification||verification.scope!==reservationScope(stay)||verification.schemaVersion!==1)return null;
 const own=verification.official;
 if(own?.scope!==verification.scope)return null;
 const offers=(verification.offers??[]).filter(o=>o.scope===verification.scope);
 const comparisons=(verification.comparisons??[]).filter(c=>offers.some(o=>o.provider===c.provider));
 return {...verification,offers,comparisons,fresh:freshObservation(own.capturedAt,now)&&offers.every(o=>freshObservation(o.capturedAt,now))};
}
export function preciseOfficial(precision,stay){
 const o=precision?.official,r=o?.rate,f=o?.facts;
 if(r?.status!=='ok'||r.currency!==stay.booked.currency||r.checkIn!==stay.checkIn||r.checkOut!==stay.checkOut||r.adults!==stay.adults||r.prepaid!==false||!positive(r.totalAmount))return null;
 const price=f?.price;const verified=price?.currency===stay.booked.currency&&price.preTaxVerified===true&&positive(price.preTaxAmount);
 const roomAmount=verified?price.preTaxAmount:r.totalAmount;
 return {rate:{...r,totalAmount:roomAmount,amountBasis:verified?'pre-tax':'unknown',precisionTaxVerified:verified,
  lowestPublicRateVerified:f?.lowestPublicRateVerified===true,availabilityVerified:f?.availabilityVerified===true,
  comparable:f?.hotelId===stay.id&&Boolean(f?.search)&&Boolean(f?.roomIdentity),
  ...(verified?{knownPayableTotal:price.totalAmount,taxesAndFees:price.taxesAndFees}:{}),
  ...(f?.approvedTaxRules?{approvedTaxRules:f.approvedTaxRules}:{})},checkedAt:r.capturedAt??o.capturedAt};
}
export function preciseSeller(precision,stay,name){
 const offer=precision?.offers.find(o=>o.provider===name),f=offer?.facts,p=f?.price;
 if(!offer||!p?.preTaxVerified||p.currency!==stay.booked.currency||!positive(p.preTaxAmount))return null;
 const comparison=precision.comparisons.find(c=>c.provider===name),ok=key=>precision.fresh&&comparison?.checks?.find(c=>c.key===key)?.state==='matched';
 const mismatch=key=>comparison?.checks?.find(c=>c.key===key)?.state==='mismatched';
 const rate={...p,totalAmount:p.totalAmount,roomAmount:p.preTaxAmount,amountBasis:'pre-tax',preTaxVerified:true,preTaxAmount:p.preTaxAmount,
  source:'direct-precision',capturedAt:offer.capturedAt,searchEvidence:f.search,hotelMatched:f.hotelId===stay.id,
  roomContext:f.roomIdentity??offer.evidence?.roomText?.slice(0,550)??'',roomIdentityVerified:ok('room'),
  cancellationText:offer.evidence?.cancellation,cancellationPolicyMatched:ok('cancellation')&&ok('penalty'),
  cancellationPolicyMismatch:mismatch('cancellation')||mismatch('penalty'),inclusionsMatched:ok('inclusions'),inclusionsMismatch:mismatch('inclusions'),paymentPolicyMatched:ok('payment'),publicRate:f.publicRate===true,restrictionsChecked:f.restrictionsChecked===true,availabilityVerified:f.availabilityVerified===true,publicRateDisallowed:f.publicRate===false};
 return {rate,checkedAt:offer.capturedAt,status:offer.status,state:offer.state};
}

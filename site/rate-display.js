import {freshObservation,reviewBrg} from './brg-readiness.js';
import {assess,providerName,reviewProviders,verifiedPreTaxAmount,roomOnlyFromBreakdown,candidateEvidence} from './brg.js';
export const stayScope=s=>JSON.stringify([s.checkIn,s.checkOut,s.adults,s.booked.currency,s.booked.room,s.booked.cancellationDeadline]);
const sellerName=value=>providerName(value)||String(value??'').trim().slice(0,80);
const positive=n=>Number.isFinite(n)&&n>0;
// Legacy Google taxEvidence was generated from the selected mode, not observed tax text.
// Do not let that old global flag certify every seller's tax basis.
export function normalizeGoogleRate(rate){
 const evidenced=rate.taxBasisVerified===true&&typeof rate.taxEvidence==='string'&&rate.taxEvidence.trim();
 const breakdown=roomOnlyFromBreakdown(rate.priceBreakdown,rate.currency);
 return evidenced||breakdown?{...rate,source:'google-hotels'}:{...rate,source:'google-hotels',amountBasis:'unknown',preTaxVerified:false,preTaxAmount:null,roomAmount:null,taxesAndFees:null,knownPayableTotal:null};
}
export function displayPrice(rate,currency){
 if(!rate||rate.currency!==currency||rate.estimatedFromNightly===true)return null;
 const breakdown=roomOnlyFromBreakdown(rate.priceBreakdown,currency);
 const preTax=rate.preTaxVerified===true&&positive(rate.roomAmount)?rate.roomAmount:verifiedPreTaxAmount(rate,currency);
 const explicitTotal=breakdown?.knownPayableTotal??rate.knownPayableTotal??(rate.amountBasis==='tax-included'?rate.totalAmount:null);
 const taxes=Number.isFinite(rate.taxesAndFees)?rate.taxesAndFees:breakdown?breakdown.includedNonRoomCharges+breakdown.excludedNonRoomCharges:null;
 if(positive(preTax))return {amount:preTax,basis:'pre-tax',total:positive(explicitTotal)?explicitTotal:null,taxes};
 if(!positive(rate.totalAmount))return null;
 return {amount:rate.totalAmount,basis:rate.amountBasis==='tax-included'?'tax-included':'unknown',total:rate.amountBasis==='tax-included'?rate.totalAmount:null,taxes};
}
export function validOfficial(result,stay){
 const m=result?.marriott;
 return m?.status==='ok'&&m.prepaid===false&&m.currency===stay.booked.currency&&positive(m.totalAmount)&&m.amountBasis==='pre-tax'&&m.checkIn===stay.checkIn&&m.checkOut===stay.checkOut&&m.adults===stay.adults?m:null;
}
export function hotelView(data,stay,now=Date.now()){
 const runs=data.runs??[];const currency=stay.booked.currency;let official,google;
 for(const run of [...runs].reverse()){
  const result=run.results?.find(x=>x.id===stay.id);if(!result)continue;
  if(!official){const rate=validOfficial(result,stay);if(rate)official={rate,checkedAt:rate.capturedAt??run.capturedAt};}
  if(!google&&result.status==='ok'&&(result.checkIn==null||result.checkIn===stay.checkIn)&&(result.checkOut==null||result.checkOut===stay.checkOut)&&(result.adults==null||result.adults===stay.adults)){const rates=[...(result.providers??[]),...(result.roomRates??[]),result.exactCandidate,result.freeCancellation,result.lowestProvider].filter(Boolean);if(rates.length)google={result,rates:rates.map(normalizeGoogleRate),checkedAt:run.capturedAt};}
  if(official&&google)break;
 }
 const attempts=data.otaStatus?.results?.find(x=>x.id===stay.id)?.providers??[];
 const googleAttempt=data.googleStatus?.results?.find(x=>x.id===stay.id);
 const actualProviders=[...new Set((google?.rates??[]).map(r=>sellerName(r.provider)).filter(Boolean))];
 const names=[...new Set([...reviewProviders,...actualProviders,...attempts.filter(x=>x.scope===stayScope(stay)).map(x=>x.provider)])];
 const sellers=names.map(name=>{
  const attempt=attempts.find(x=>x.provider===name&&x.scope===stayScope(stay));
  const observation=attempt?.checkoutObservation;
  const direct=[observation,attempt?.status==='ok'?attempt:null,attempt?.lastSuccessful].filter(x=>x&&displayPrice(x,currency)).sort((a,b)=>(Date.parse(b.capturedAt)||0)-(Date.parse(a.capturedAt)||0))[0];
  const googleRate=google?.rates.filter(x=>sellerName(x.provider)===name&&displayPrice(x,currency)).sort((a,b)=>Number(candidateEvidence(stay,b).roomMatched&&candidateEvidence(stay,b).cancellationMatched)-Number(candidateEvidence(stay,a).roomMatched&&candidateEvidence(stay,a).cancellationMatched)||(verifiedPreTaxAmount(a,currency)==null)-(verifiedPreTaxAmount(b,currency)==null)||a.totalAmount-b.totalAmount)[0];
  const directAt=direct?.capturedAt??attempt?.capturedAt;
  const useDirect=Boolean(direct)&&(!googleRate||(Date.parse(directAt)||0)>=(Date.parse(google?.checkedAt)||0));
  const rate=useDirect?direct:googleRate;
  const checkedAt=useDirect?directAt:google?.checkedAt;
  const price=displayPrice(rate,currency);
  const selectedAttempt=useDirect?attempt:googleAttempt;
  const failed=Boolean(selectedAttempt&&selectedAttempt.status==='error'&&
    (Date.parse(selectedAttempt.capturedAt)||0)>=(Date.parse(checkedAt)||0));
  const ageExpired=Boolean(price)&&!freshObservation(checkedAt,now);
  return {name,price,checkedAt,rate,attempt,lower:false,ageExpired,refreshFailed:failed,failedAt:failed?selectedAttempt.capturedAt:null,old:Boolean(price)&&(ageExpired||failed),source:useDirect?'판매처 화면':'Google 표시가'};
 });
 const officialAttempt=data.collectorStatus?.results?.find(x=>x.id===stay.id);
 const officialOld=Boolean(official)&&(!freshObservation(official.checkedAt,now)||(officialAttempt&&officialAttempt.status!=='ok'&&officialAttempt.status!=='not-collected'));
 const difference=official?Math.round((stay.booked.roomSubtotal-official.rate.totalAmount)*100)/100:null;
 for(const seller of sellers){
  seller.brg=reviewBrg({stay,...seller,official,officialOld,result:seller.source==='Google 표시가'?google?.result:undefined,now});
  const evidence=seller.rate?.searchEvidence??(seller.source==='Google 표시가'?google?.result.searchEvidence:seller.rate);
  const scopeConfirmed=evidence?.checkIn===stay.checkIn&&evidence?.checkOut===stay.checkOut&&evidence?.adults===stay.adults&&evidence?.children===(stay.children??0);
  const base=official?.rate.totalAmount;
  const enoughScope=scopeConfirmed;
  const lower=Number.isFinite(base)&&seller.price?.amount<base-0.005;
  const margin=lower?assess(base,seller.price.amount,{currency}).pass:false;
  seller.screen={lower:Boolean(lower&&enoughScope&&!seller.brg.wrongRoom),priceMargin:Boolean(margin),
    difference:lower?Math.round((base-seller.price.amount)*100)/100:null,
    basisKnown:seller.price?.basis!=='unknown',eligible:false,verified:false};
  seller.lower=Boolean(seller.screen.lower&&!seller.old&&!officialOld);
  // Retained observations can still be review leads, but never current successes.
  seller.reviewLead=Boolean(seller.screen.lower);
 }
 return {stay,currency,official,officialOld,difference,officialLower:!officialOld&&difference>0.005,sellers,cheaper:sellers.some(x=>x.lower&&!x.old&&!x.brg.wrongRoom),brgCandidates:sellers.filter(x=>x.brg.verified).length,reviewLeads:sellers.filter(x=>x.reviewLead).length,google};
}

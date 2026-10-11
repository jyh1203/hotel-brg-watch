export function otaScope(stay) {
 return JSON.stringify([stay.checkIn,stay.checkOut,stay.adults,stay.booked.currency,stay.booked.room,stay.booked.cancellationDeadline]);
}
export function mergeOtaAttempts(previous,next) {
 const nextIds=new Set(next.results.map(x=>x.id));
 return {...next,results:[...(previous.results??[]).filter(x=>!nextIds.has(x.id)),...next.results.map(result=>{
  const prior=previous.results?.find(x=>x.id===result.id);
  const incoming=result.providers??[];const providerNames=new Set(incoming.map(x=>x.provider));
  return {...result,providers:[...(prior?.providers??[]).filter(x=>!providerNames.has(x.provider)),...incoming.map(attempt=>{
   const old=prior?.providers?.find(x=>x.provider===attempt.provider&&x.scope&&x.scope===attempt.scope);
   const success=attempt.status==='ok'?attempt:old?.status==='ok'?old:old?.lastSuccessful;
   return {...attempt,...(success?{lastSuccessful:{...success,lastSuccessful:undefined}}:{})};
  })]};
 })]};
}

const compact=s=>String(s??'').replace(/\s+/g,' ').trim();
export function readMarriottQuoteSnapshot(){
 const visible=e=>e.getBoundingClientRect().width&&!e.closest('[aria-hidden="true"]');
 const roomTexts=[...document.querySelectorAll('main div,main span,main p')].filter(e=>visible(e)&&e.childElementCount===0&&/Guest\s*room,/i.test(e.innerText??'')&&(e.innerText??'').length<250).map(e=>e.innerText.trim());
 const room=[...new Set(roomTexts)][0]??null;
 const vat=(document.body.innerText.match(/All rates are quoted (?:exclusive|inclusive) of VAT\./i)??[])[0]??null;
 const headings=[...document.querySelectorAll('h1,h2,h3,h4')].filter(e=>/Summary of Charges/i.test(e.innerText));
 let lines=[];
 for(const heading of headings){let node=heading;
  for(let depth=0;depth<7&&node;depth++,node=node.parentElement){
   if(['BODY','HTML','MAIN','FORM'].includes(node.tagName))break;
   const text=node.innerText??'';
   if(!/Est(?:\.|imated)? Taxes and Fees/i.test(text)||!/Total for Stay/i.test(text)||text.length>=7000||/Guest Information|Payment Details|Hello,|@|First Name|Last Name|Email Address|Card Number/i.test(text))continue;
   // Return only closed-set public price labels and money/date tokens, never a raw ancestor's text.
   lines=text.split('\n').map(x=>x.trim()).filter(x=>/^(?:Summary of Charges|Room\s*\d+\s*x\s*\d+\s*Nights?|Est\. Taxes and Fees|Estimated Taxes and Fees|Total for Stay|EUR|JPY|USD|GBP|KRW)$/i.test(x)||/^[\d,.]+\s*(?:EUR|JPY|USD|GBP|KRW)?$/.test(x)||/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*[A-Za-z]+\s*\d{1,2},?\s*20\d{2}(?:\s*[\d,.]+\s*(?:EUR|JPY|USD|GBP|KRW))?$/.test(x));
   if(lines.length)break;
  }
  if(lines.length)break;
 }
 return {room,vatStatement:vat,priceLines:lines};
}
export function parseMarriottQuote(snapshot,stay){
 if(!snapshot||!Array.isArray(snapshot.priceLines)||!snapshot.room||!stay.match?.roomPatterns?.length||!stay.match?.bedPatterns?.length)return null;
 if(!stay.match.roomPatterns.every(p=>new RegExp(p,'i').test(snapshot.room))||!stay.match.bedPatterns.every(p=>new RegExp(p,'i').test(snapshot.room))||(stay.match.excludedPatterns??[]).some(p=>new RegExp(p,'i').test(snapshot.room)))return null;
 const text=compact(snapshot.priceLines.join(' ')),currency=stay.booked.currency;
 const total=text.match(new RegExp('Total for Stay\\s*([\\d,.]+)\\s*'+currency,'i'));
 const tax=text.match(new RegExp('(?:Est\\.|Estimated) Taxes and Fees\\s*([\\d,.]+)\\s*'+currency,'i'));
 let subtotal=text.match(new RegExp('Room\\s*\\d+\\s*x\\s*\\d+\\s*Nights?\\s*([\\d,.]+)\\s*'+currency,'i'));
 if(!total||!tax)return null;
 const number=m=>Number(m[1].replaceAll(',',''));const totalAmount=number(total),taxesAndFees=number(tax);
 let roomAmount=subtotal?number(subtotal):null;
 if(roomAmount===null){
  const nightly=[...text.matchAll(new RegExp('(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\\s*[A-Za-z]+\\s*\\d{1,2},?\\s*20\\d{2}\\s*([\\d,.]+)\\s*'+currency,'g'))];
  const nights=Math.round((Date.parse(stay.checkOut)-Date.parse(stay.checkIn))/86400000);if(nightly.length===nights)roomAmount=Math.round(nightly.reduce((sum,m)=>sum+number(m),0)*100)/100;
 }
 if(!(roomAmount>0)||taxesAndFees<0||Math.abs(roomAmount+taxesAndFees-totalAmount)>.005)return null;
 const vatExcluded=/All rates are quoted exclusive of VAT\./i.test(snapshot.vatStatement??'');
 return {currency,roomDisplayAmount:roomAmount,totalAmount,listedTaxesAndFees:taxesAndFees,vatStatement:snapshot.vatStatement,preTaxVerified:vatExcluded,...(vatExcluded?{preTaxAmount:roomAmount,amountBasis:'pre-tax',taxesAndFees,knownPayableTotal:totalAmount}:{}),vatSeparationVerified:vatExcluded};
}
// Writer guard: precision status/public assets must never contain account summaries.
export function assertPublicVerification(value){
 const inspect=x=>{
  if(typeof x==='string'&&(/Guest Information|Payment Details|Hello,|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:Visa|Mastercard)\s*[•*]+\s*\d{4}/i.test(x)))throw new Error('Verification contains non-public account data');
  if(Array.isArray(x))x.forEach(inspect);else if(x&&typeof x==='object')Object.values(x).forEach(inspect);
 };
 inspect(value);return value;
}

import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {readMarriottQuoteSnapshot,parseMarriottQuote,assertPublicVerification} from '../src/marriott-quote.mjs';
const stay={booked:{currency:'EUR'},match:{roomPatterns:['standard'],bedPatterns:['king'],excludedPatterns:['twin']},checkIn:'2027-04-03',checkOut:'2027-04-07'};
test('quote reader exports only scoped public price tokens, never guest/account/payment summaries',async()=>{
 const b=await chromium.launch();try{const p=await b.newPage();await p.setContent('<main><div>Guest Information</div><div>Example Person</div><div>example@example.test</div><div>Payment Details Visa •••• 1234</div><span>Standard King Room, Guest room, 1 King</span><p>All rates are quoted exclusive of VAT.</p><section><h2>Summary of Charges</h2><div>Room 1 x 4 Nights</div><div>760.00 EUR</div><div>Est. Taxes and Fees</div><div>76.00 EUR</div><div>Total for Stay</div><div>836.00 EUR</div></section></main>');
 const snapshot=await p.evaluate(readMarriottQuoteSnapshot);assert.equal(snapshot.room,'Standard King Room, Guest room, 1 King');assert.ok(snapshot.priceLines.includes('760.00 EUR'));assert.doesNotMatch(JSON.stringify(snapshot),/Example Person|example@|1234|Guest Information|Payment Details/);assert.doesNotThrow(()=>assertPublicVerification(snapshot));
 const price=parseMarriottQuote(snapshot,stay);assert.equal(price.preTaxAmount,760);assert.equal(price.totalAmount,836);assert.equal(price.preTaxVerified,true);
 assert.equal(parseMarriottQuote({...snapshot,room:'Standard 2 Twins Room, Guest room, 2 Twin'},stay),null);
 }finally{await b.close();}
});
test('writer rejects account-like output and inclusive/unknown VAT cannot become verified pretax',()=>{
 for(const text of ['Guest Information','Payment Details','example@example.test','Visa •••• 1234'])assert.throws(()=>assertPublicVerification({evidence:{text}}),/non-public/);
 const snapshot={room:'Standard King Room, Guest room, 1 King',priceLines:['Room 1 x 4 Nights','760.00 EUR','Est. Taxes and Fees','76.00 EUR','Total for Stay','836.00 EUR'],vatStatement:'All rates are quoted inclusive of VAT.'};assert.equal(parseMarriottQuote(snapshot,stay).preTaxVerified,false);assert.equal(parseMarriottQuote({...snapshot,vatStatement:null},stay).preTaxVerified,false);
});

import {mountClaimPlan} from './claim-plan-ui.js?v=20261027-claim-v1';
import {parsePriceInput,quickPriceComparison} from './quick-price.js';
import {reviewProviders} from './brg.js';
import {hotelView,validOfficial,displayPrice} from './rate-display.js?v=20261027-claim-v1';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(n,c)=>new Intl.NumberFormat('ko-KR',{style:'currency',currency:c,maximumFractionDigits:c==='JPY'?0:2}).format(n);
const time=at=>at&&!Number.isNaN(Date.parse(at))?new Date(at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'확인 기록 없음';
const basis=p=>p?.basis==='pre-tax'?'세전':p?.basis==='tax-included'?'세금 포함':'세금 미확인';
const safeLink=(href,fallback)=>{try{const u=new URL(href);return u.protocol==='https:'&&!u.username&&!u.password?u.href:fallback;}catch{return fallback;}};
const link=(href,label,css='')=>`<a class="${css}" href="${esc(href)}" target="_blank" rel="noreferrer">${esc(label)} ↗</a>`;
function row(label,price,currency,{css='',note='',pending='미확인'}={}){
 const extra=[];
 if(Number.isFinite(price?.taxes))extra.push(`세금·기타요금 ${money(price.taxes,currency)}`);
 if(price?.basis==='pre-tax'&&Number.isFinite(price.total))extra.push(`총액 ${money(price.total,currency)}`);
 return `<div class="price-row ${css}"><div class="price-name">${esc(label)}${note?`<small>${esc(note)}</small>`:''}</div><div class="price-value">${price?`<strong>${money(price.amount,currency)}</strong><span class="basis">${basis(price)}</span>`:`<span class="pending">${pending}</span>`}${extra.length?`<small>${esc(extra.join(' · '))}</small>`:''}</div></div>`;
}
function card(view,data){
 const {stay,currency,official,officialOld,difference,officialLower,sellers}=view;
 const officialLink=`https://www.marriott.com/en-us/hotels/${stay.marriott.propertyCode.toLowerCase()}-${stay.marriott.slug}/rooms/`;
 const booked={amount:stay.booked.roomSubtotal,basis:'pre-tax',total:stay.booked.total,taxes:stay.booked.taxesAndFees};
 const latest=official?.checkedAt;
 const leads=sellers.filter(s=>s.reviewLead);
 const alert=officialLower?`${officialOld?'지난 확인 ':''}공식가가 예약보다 ${money(difference,currency)} 낮아요`:leads.length?`공식 세전가보다 낮은 표시가 ${leads.length}건 · BRG 검토${leads.every(s=>s.old)?' · 현재가 재확인':''}`:officialOld?'메리어트 재조회 필요':official?'공식가 인하 없음':'공식가 확인 대기';
 const officialNote=official?(officialOld?'지난 확인 가격 · '+time(latest):time(latest)+' 확인'):'가격 확인 후 표시';
 const history=[];const seen=new Set();
 for(const run of [...(data.runs??[])].reverse()){
  const rate=validOfficial(run.results?.find(x=>x.id===stay.id),stay);if(!rate)continue;const at=rate.capturedAt??run.capturedAt;const day=at?.slice(0,10);if(seen.has(day))continue;seen.add(day);history.push(`<tr><td>${esc(time(at))}</td><td>${money(rate.totalAmount,currency)} · 세전</td></tr>`);if(history.length===7)break;
 }
 const visibleSellers=sellers.filter(s=>s.price&&reviewProviders.includes(s.name));
 const other=sellers.filter(s=>s.price&&!reviewProviders.includes(s.name)).sort((a,b)=>a.price.amount-b.price.amount)[0];if(other)visibleSellers.push(other);
 const sellerDetails=sellers.map(s=>`<li><b>${esc(s.name)}${s.price?' · '+money(s.price.amount,currency)+' '+basis(s.price):''}</b> · ${s.price?esc(s.source)+' · '+esc(time(s.checkedAt))+' 확인'+(s.refreshFailed?' · 최근 재조회 실패 · 이전 확인값 유지':s.ageExpired?' · 24시간 경과 · 현재가 확인':''):'가격 미확인'}${s.refreshFailed?' · 이번 조회 미완료':''}${s.rate?.roomContext?`<br>${esc(s.rate.roomContext)}`:''}${s.rate?.cancellationText?`<br>${esc(s.rate.cancellationText)}`:''}${s.price?`<br>BRG: ${esc(s.brg.blockers.map(c=>c.label).join(' · ')||'자동 확인 항목 충족 · 최종 심사는 Marriott')}`:''}</li>`).join('');
 return `<article class="card ${officialLower?'has-rate-drop':''}" data-stay-id="${esc(stay.id)}">
 <div class="card-head"><div><p>${esc(stay.checkIn)} → ${esc(stay.checkOut)} · ${Math.round((Date.parse(stay.checkOut)-Date.parse(stay.checkIn))/86400000)}박 · 성인 ${stay.adults}명</p><h2>${esc(stay.displayName??stay.hotel)}</h2></div></div>
 <div class="claim-plan"></div>
 <details class="price-details"><summary>전체 가격·세금·공식가 인하 확인</summary>
 <p class="price-alert ${officialLower?'lower':leads.length?'review':''}">${esc(alert)}</p>
 <section class="rate-list" aria-label="호텔 요금 비교">
 ${row('내 예약',booked,currency,{css:'booked-price'})}
 ${row('메리어트',official?displayPrice(official.rate,currency):null,currency,{css:'official-price'+(officialLower?' lower':''),note:officialNote})}
 ${visibleSellers.map(s=>row(s.name,s.price,currency,{css:'seller-price'+(s.reviewLead?' lower':''),note:[s.source,`${time(s.checkedAt)} 확인`,s.refreshFailed?`${time(s.failedAt)} 재조회 실패 · 확인값 유지`:s.ageExpired?'24시간 경과 · 현재가 확인':'',s.reviewLead?`${officialOld?'지난 공식 세전가':'공식 세전가'}보다 ${money(s.screen.difference,currency)} 낮음 · ${s.screen.priceMargin?'가격 차이 검토':'1% 초과 차이 미달'} · 세금·객실 조건 확인`:s.brg.verified?s.brg.label:s.brg.wrongRoom?'객실·침대 조건 불일치':s.price.basis==='pre-tax'?'객실·취소 조건 확인':'객실·세금 조건 확인'].filter(Boolean).join(' · ')})).join('')}${visibleSellers.length?'':row('타사 요금',null,currency)}
 </section></details>
 <details class="quick-price"><summary>직접 확인한 Google 총액 비교 <span>보조 계산</span></summary>
 <form class="quick-price-form" data-quick-stay-id="${esc(stay.id)}">
 <p>직접 확인한 <b>동일 호텔·일정·인원·객실 수의 세금 포함 숙박 전체 총액</b>을 입력하세요. 수집된 요금이나 BRG 판정은 바뀌지 않습니다.</p>
 <label>표시 통화<select name="currency">${[...new Set([currency,'EUR','USD','GBP','JPY','KRW'])].map(c=>`<option value="${c}">${c}</option>`).join('')}</select></label>
 <label>Google 숙박 전체 총액<input name="total" type="text" inputmode="decimal" autocomplete="off" required placeholder="총액만 입력"></label>
 <details class="optional-fees"><summary>세전 참고 계산 · 세금·수수료를 아는 경우만</summary>
 <label>위 총액에 이미 포함된 세금·수수료<input name="fees" type="text" inputmode="decimal" autocomplete="off" placeholder="모르면 비워 두세요"></label>
 <p>별도 현장 납부액은 빼지 마세요. 빈칸을 0원으로 가정하지 않습니다.</p></details>
 <button type="submit">총액 비교</button>
 <output class="quick-price-result" aria-live="polite" aria-atomic="true"></output>
 </form></details>
 <div class="card-actions">${link(officialLink,'메리어트 가격 확인','primary')}</div>
 <details class="hotel-details"><summary>BRG 확인 항목·객실·가격 기록</summary>
 <p>${esc(stay.booked.room)}<br>${esc(stay.booked.cancellation)} · ${esc(stay.booked.cancellationDeadline)}</p>
 <p>메리어트 · ${esc(time(latest))}${official?.rate.rateName?' · '+esc(official.rate.rateName):''}</p>
 <ul>${sellerDetails}</ul>
 <div class="seller-links">${sellers.filter(s=>stay.ota?.urls?.[s.name]).map(s=>link(safeLink(stay.ota.urls[s.name],officialLink),s.name+' 요금 보기')).join('')}${link(safeLink(view.google?.result.detailUrl??view.google?.result.searchUrl,`https://www.google.com/travel/search?q=${encodeURIComponent(stay.hotel)}`),'Google 가격 보기')}</div>
 ${history.length?`<h3>최근 메리어트 객실료</h3><table><thead><tr><th>확인 시각</th><th>객실료</th></tr></thead><tbody>${history.join('')}</tbody></table>`:''}
 <p class="detail-note">금액은 숙박 전체 기준입니다. 세금이 확인되면 따로 표시하며, 세금 포함 여부에 근거가 없는 Google 가격은 세금 미확인 표시가로 보여줍니다. 세금 포함 총액이 공식 세전가보다 낮으면 가격 검토 근거가 되지만 객실·취소·공개 요금·기한 확인이 별도로 필요합니다. BRG는 동일 객실·취소조건·공개 요금과 신청 기한을 공식 사이트에서 확인하세요.</p>
 </details></article>`;
}
async function render(){
 const response=await fetch(`data.json?v=${Date.now()}`,{cache:'no-store'});if(!response.ok)throw new Error('가격 데이터를 불러오지 못했습니다.');
 const data=await response.json();const views=(data.config?.stays??[]).map(s=>hotelView(data,s));
 const latest=[data.runs?.at(-1)?.capturedAt,data.otaStatus?.capturedAt].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
 document.querySelector('#updated').textContent=`업데이트 ${time(latest)} · 숙박 전체 요금`;
 const plans=new Map();
 const updateSummary=()=>{document.querySelector('#summary').innerHTML=`<div><b>${[...plans.values()].filter(p=>p.offers.some(o=>o.worthwhile)).length}곳</b><span>BRG 조건·기존 예약 대비 절감 모두 확인</span></div><div><b>${[...plans.values()].filter(p=>p.offers.some(o=>!o.rejected&&o.review.pricePass&&!o.worthwhile)).length}곳</b><span>가격 후보 · 조건·세금 확인 중</span></div>`;};
 document.querySelector('#cards').innerHTML=views.map(v=>card(v,data)).join('')||'<article class="empty">등록된 호텔이 없습니다.</article>';
 views.forEach(view=>mountClaimPlan(document.querySelector(`[data-stay-id="${view.stay.id}"] .claim-plan`),view,plan=>{plans.set(view.stay.id,plan);updateSummary();}));
 updateSummary();
 document.querySelectorAll('.quick-price-form').forEach(form=>{
  const output=form.querySelector('output');
  const clear=()=>{output.textContent='';output.removeAttribute('data-status');};
  form.addEventListener('input',clear);form.addEventListener('change',clear);
  form.addEventListener('submit',event=>{
   event.preventDefault();
   const stay=data.config.stays.find(s=>s.id===form.dataset.quickStayId);
   const currency=form.elements.currency.value;
   const result=quickPriceComparison({stay,currency,total:parsePriceInput(form.elements.total.value,currency),includedFees:parsePriceInput(form.elements.fees.value,currency)});
   output.dataset.status=result.error?'error':'reference';
   if(result.error){output.textContent=result.error;return;}
   const lines=[`Google 입력 총액 ${money(result.total,currency)} · 세금 포함`];
   if(result.bookedTotal!==null)lines.push(`내 예약 총액 ${money(result.bookedTotal,currency)} · 세금 포함`);
   if(result.difference!==null)lines.push(result.difference>0?`예약보다 ${money(result.difference,currency)} 낮음 · 총액 참고 비교`:result.difference<0?`예약보다 ${money(-result.difference,currency)} 높음 · 총액 참고 비교`:'예약과 같은 총액');
   if(result.averageNight!==null)lines.push(`${result.nights}박 · 1박 평균 ${money(result.averageNight,currency)} (단순 평균)`);
   lines.push(result.referenceRoomAmount===null?'세전 객실료 미확인 · 수수료 없이 총액만 비교':`입력액 기준 세전 참고 객실료 ${money(result.referenceRoomAmount,currency)}`);
   lines.push('추가 현장 납부액·객실·취소조건은 별도 확인. BRG 적격 판정이나 저장된 가격에는 반영하지 않습니다.');
   output.textContent=lines.join('\n');
  });
 });
}
render().catch(error=>{document.querySelector('#updated').textContent='가격 표시 오류';document.querySelector('#cards').innerHTML=`<article class="empty">${esc(error.message)}</article>`;console.error(error);});

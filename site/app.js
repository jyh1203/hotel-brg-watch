import {reviewProviders} from './brg.js';
import {hotelView,validOfficial,displayPrice} from './rate-display.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(n,c)=>new Intl.NumberFormat('ko-KR',{style:'currency',currency:c,maximumFractionDigits:c==='JPY'?0:2}).format(n);
const time=at=>at&&!Number.isNaN(Date.parse(at))?new Date(at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'확인 기록 없음';
const basis=p=>p?.basis==='pre-tax'?'세전':p?.basis==='tax-included'?'세후':'표시가';
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
 const alert=officialLower?`${officialOld?'지난 확인 ':''}공식가가 예약보다 ${money(difference,currency)} 낮아요`:view.cheaper?'더 낮은 타사 요금이 있어요 · 조건 확인':officialOld?'메리어트 재조회 필요':official?'공식가 인하 없음':'공식가 확인 대기';
 const officialNote=official?(officialOld?'지난 확인 가격':time(latest)+' 확인'):'가격 확인 후 표시';
 const history=[];const seen=new Set();
 for(const run of [...(data.runs??[])].reverse()){
  const rate=validOfficial(run.results?.find(x=>x.id===stay.id),stay);if(!rate)continue;const at=rate.capturedAt??run.capturedAt;const day=at?.slice(0,10);if(seen.has(day))continue;seen.add(day);history.push(`<tr><td>${esc(time(at))}</td><td>${money(rate.totalAmount,currency)} · 세전</td></tr>`);if(history.length===7)break;
 }
 const visibleSellers=sellers.filter(s=>s.price&&reviewProviders.includes(s.name));
 const other=sellers.filter(s=>s.price&&!reviewProviders.includes(s.name)).sort((a,b)=>a.price.amount-b.price.amount)[0];if(other)visibleSellers.push(other);
 const sellerDetails=sellers.map(s=>`<li><b>${esc(s.name)}${s.price?' · '+money(s.price.amount,currency)+' '+basis(s.price):''}</b> · ${s.price?esc(s.source)+' · '+esc(time(s.checkedAt))+' 확인'+(s.old?' · 재조회 필요':''):'가격 미확인'}${s.attempt?.status==='error'?' · 이번 조회 미완료':''}${s.rate?.roomContext?`<br>${esc(s.rate.roomContext)}`:''}${s.rate?.cancellationText?`<br>${esc(s.rate.cancellationText)}`:''}${s.price?`<br>BRG: ${esc(s.brg.blockers.map(c=>c.label).join(' · ')||'자동 확인 항목 충족 · 최종 심사는 Marriott')}`:''}</li>`).join('');
 return `<article class="card ${officialLower?'has-rate-drop':''}" data-stay-id="${esc(stay.id)}">
 <div class="card-head"><div><p>${esc(stay.checkIn)} → ${esc(stay.checkOut)} · ${Math.round((Date.parse(stay.checkOut)-Date.parse(stay.checkIn))/86400000)}박 · 성인 ${stay.adults}명</p><h2>${esc(stay.displayName??stay.hotel)}</h2></div></div>
 <p class="price-alert ${officialLower?'lower':view.cheaper?'review':''}">${esc(alert)}</p>
 <section class="rate-list" aria-label="호텔 요금 비교">
 ${row('내 예약',booked,currency,{css:'booked-price'})}
 ${row('메리어트',official?displayPrice(official.rate,currency):null,currency,{css:'official-price'+(officialLower?' lower':''),note:officialNote})}
 ${visibleSellers.map(s=>row(s.name,s.price,currency,{css:'seller-price'+(s.lower?' lower':''),note:[s.source==='Google 표시가'?'Google 표시가':'',s.brg.label].filter(Boolean).join(' · ')})).join('')}${visibleSellers.length?'':row('타사 요금',null,currency)}
 </section>
 <div class="card-actions">${link(officialLink,'메리어트 가격 확인','primary')}${link('https://brgclaimsubmission.fornova.com/marriott','BRG 신청')}</div>
 <details class="hotel-details"><summary>BRG 확인 항목·객실·가격 기록</summary>
 <p>${esc(stay.booked.room)}<br>${esc(stay.booked.cancellation)} · ${esc(stay.booked.cancellationDeadline)}</p>
 <p>메리어트 · ${esc(time(latest))}${official?.rate.rateName?' · '+esc(official.rate.rateName):''}</p>
 <ul>${sellerDetails}</ul>
 <div class="seller-links">${sellers.filter(s=>stay.ota?.urls?.[s.name]).map(s=>link(safeLink(stay.ota.urls[s.name],officialLink),s.name+' 요금 보기')).join('')}${link(safeLink(view.google?.result.detailUrl??view.google?.result.searchUrl,`https://www.google.com/travel/search?q=${encodeURIComponent(stay.hotel)}`),'Google 가격 보기')}</div>
 ${history.length?`<h3>최근 메리어트 객실료</h3><table><thead><tr><th>확인 시각</th><th>객실료</th></tr></thead><tbody>${history.join('')}</tbody></table>`:''}
 <p class="detail-note">금액은 숙박 전체 기준입니다. 세금이 확인되면 따로 표시하며, 세전 금액을 확인하지 못한 요금은 세후 총액 또는 표시가를 그대로 보여줍니다. BRG는 동일 객실·취소조건·공개 요금과 신청 기한을 공식 사이트에서 확인하세요.</p>
 </details></article>`;
}
async function render(){
 const response=await fetch(`data.json?v=${Date.now()}`,{cache:'no-store'});if(!response.ok)throw new Error('가격 데이터를 불러오지 못했습니다.');
 const data=await response.json();const views=(data.config?.stays??[]).map(s=>hotelView(data,s));
 const latest=[data.runs?.at(-1)?.capturedAt,data.otaStatus?.capturedAt].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
 document.querySelector('#updated').textContent=`업데이트 ${time(latest)} · 숙박 전체 요금`;
 document.querySelector('#summary').innerHTML=`<div><b>${views.filter(v=>v.officialLower).length}곳</b><span>최근 공식가가 내 예약보다 낮음</span></div><div><b>${views.filter(v=>v.cheaper).length}곳</b><span>저가 발견 · BRG 적격 미확정</span></div>`;
 document.querySelector('#cards').innerHTML=views.map(v=>card(v,data)).join('')||'<article class="empty">등록된 호텔이 없습니다.</article>';
}
render().catch(error=>{document.querySelector('#updated').textContent='가격 표시 오류';document.querySelector('#cards').innerHTML=`<article class="empty">${esc(error.message)}</article>`;console.error(error);});

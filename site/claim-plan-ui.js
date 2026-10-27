import {precisionHtml} from './precision-ui.js?v=20261027-precision-v1';
import {evaluatePlan,claimPacket,reservationScope,safeOfferLink} from './claim-plan.js?v=20261027-precision-v1';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(n,c)=>Number.isFinite(n)?new Intl.NumberFormat('ko-KR',{style:'currency',currency:c,maximumFractionDigits:c==='JPY'?0:2}).format(n):'미확인';
const date=t=>t&&!Number.isNaN(Date.parse(t))?new Date(t).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+' 한국시간':'미확인';
const key=s=>'brg-plan:v1:'+s.id;
function load(stay){try{const p=JSON.parse(localStorage.getItem(key(stay)));return p?.scope===reservationScope(stay)&&(!p.reservedAt||Number.isFinite(Date.parse(p.reservedAt)))?p:{};}catch{return {};}}
const checked=b=>b?' checked':'';
export function mountClaimPlan(root,view,onChange=()=>{}){
 let prefs=load(view.stay);let chosen=null;
 function draw(){
  const plan=evaluatePlan(view,prefs),stay=view.stay,c=stay.booked.currency;
  const offer=plan.offers.find(o=>o.seller.name===chosen)??plan.best;chosen=offer?.seller.name;
  const cost=offer?.cost;
  const windowText=plan.window.deadline?`신청 마감 ${date(plan.window.deadline)} · ${Math.max(0,Math.floor((Date.parse(plan.window.deadline)-Date.now())/3600000))}시간 남음`:plan.window.label;
  const brgLabel=offer?.rejected||offer?.priceFail?'조건 불일치':offer?.ready?'확인 항목 충족':offer?.conditionsReady?'요금 조건 확인 · 예약 전':'조건 확인 중';
  const profitLabel=cost?.state==='confirmed-calculation'?(cost.cheaper?'기존 예약보다 저렴':'기존 예약 유지 유리'):cost?.total!=null?'절감 예상 · 세금 미확정':'최종 부담액 확인 필요';
  root.innerHTML=`<section class="claim-overview" data-plan-state="${esc(offer?.state??'empty')}">
   <p class="plan-eyebrow">${plan.mode==='plan'?'현재 공식 요금으로 새 예약 검토':plan.mode==='new'?'새 공식 예약으로 신청 검토':'기존 예약으로 신청 검토'}</p>
   <h3>${esc(offer?.label??'비교 요금 확인 대기')}</h3>
   <div class="dual-check"><div><span>① BRG 조건</span><b>${esc(brgLabel)}</b></div><div><span>② 내 예약보다 유리?</span><b>${esc(profitLabel)}</b></div></div>
   <p class="claim-window">${esc(windowText)}</p>
   ${offer?`<dl class="plan-prices"><div><dt>내 기존 예약 · 세금 포함</dt><dd>${money(stay.booked.total,c)}</dd></div><div><dt>${esc(offer.seller.name)} · ${offer.review.amount===null?'비교 표시가':'비교 세전'}</dt><dd>${money(offer.review.amount??offer.seller.price.amount,c)}${offer.review.amount===null?' · 세금 미확인':''}</dd></div><div><dt>BRG 승인 가정 객실료${plan.reward==='points'?' · 5,000P 별도':''}</dt><dd>${money(cost.room,c)}</dd></div><div><dt>승인 후 ${cost.state==='confirmed-calculation'?'계산 총액':'추정 총액'} · 세금 포함</dt><dd>${money(cost.total,c)}</dd></div><div class="saving"><dt>기존 예약 대비 ${cost.state==='confirmed-calculation'?'절감액':'추정 차액'}</dt><dd>${money(cost.saving,c)}</dd></div></dl><p class="estimate-note">${cost.state==='estimate'?`참고 추정: ${esc(cost.taxNote)}. Marriott 승인 후 실제 세금과 다를 수 있어 두 조건 충족으로 판정하지 않습니다.`:cost.state==='confirmed-calculation'?'확인된 세금 계산 근거 기준이며 최종 승인·청구액은 Marriott에서 확인합니다.':'Marriott 세금·VAT가 미확인이어서 승인 후 총액과 절감액을 아직 계산하지 않습니다. 판매처 세금으로 대신 계산하지 않습니다.'}${cost.cancel?.known?' 기존 예약 무료취소 기한 내 취소비용 0 기준.':' 기존 예약 취소비용·기한 추가 확인 필요.'}</p>`:'<p>동일 일정·인원의 실제 판매 요금을 확인한 뒤 비교합니다.</p>'}
   <button type="button" class="plan-primary">${esc(offer?.action??'검토 기준 확인')}</button>
  </section>
  <details class="claim-details"><summary>조건 비교·신청 준비${offer?' · '+esc(offer.seller.name):''}</summary>
   ${plan.offers.length?`<label class="offer-selector">비교할 판매처<select name="offer">${plan.offers.map(o=>`<option value="${esc(o.seller.name)}"${o===offer?' selected':''}>${esc(o.seller.name)} · ${money(o.review.amount??o.seller.price.amount,c)}${o.review.amount===null?' (세전 미확인)':''}</option>`).join('')}</select></label>`:''}
   ${offer?`<p>${esc(date(offer.seller.checkedAt))} 가격 관측 · 현재 공식 객실료 ${money(view.official?.rate.totalAmount,c)}. 취소조건·혜택은 같은 요금끼리 비교합니다.</p><ul class="claim-checks">${offer.checks.map(q=>`<li class="${q.ok?'ok':'pending'}"><b>${q.ok?'확인':'미확인'}</b> ${esc(q.label)}</li>`).join('')}</ul>`:''}
   <p>가격·요금 검증 후 새 무료취소 공식 예약 검토 → 실제 예약 정보 등록 → 조건 재확인 → 공식 접수. 기존 예약은 승인 결과와 총액·취소기한을 확인한 뒤 직접 처리하세요. 예약·취소·제출은 자동 실행하지 않습니다.</p>
   ${offer&&safeOfferLink(offer.seller,stay)?`<a href="${esc(safeOfferLink(offer.seller,stay))}" target="_blank" rel="noreferrer">${esc(offer.seller.name)} 호텔 페이지 · 같은 요금 재선택 ↗</a>`:'<p>이 판매처의 선택 요금 직접 링크는 미확보입니다. 아래 Google·판매처 가격 보기에서 같은 조건을 다시 선택해야 합니다.</p>'}
   <details class="packet"><summary>${offer?.worthwhile?'신청자료':'검토 초안'} 보기·복사</summary><textarea readonly aria-label="BRG 검토 자료">${esc(claimPacket(plan,offer))}</textarea><button type="button" class="copy-packet">자료 복사</button><output class="copy-result" aria-live="polite"></output><a href="https://brgclaimsubmission.fornova.com/marriott" target="_blank" rel="noreferrer">공식 접수창 열기 · 최종 확인 필요 ↗</a></details>
  </details>
  ${precisionHtml(view)}
  <details class="plan-settings"><summary>예약 기준·보상 선택</summary>
   <form class="plan-form">
    <p>기존 예약 총액은 유지합니다. 아래 설정은 이 브라우저에만 저장되며 서버·수집 데이터에는 반영되지 않습니다. 예약번호·회원번호는 입력하지 않습니다.</p>
    <label>검토 기준<select name="mode"><option value="plan"${plan.mode==='plan'?' selected':''}>현재 공식가로 새 무료취소 예약 검토</option><option value="new"${plan.mode==='new'?' selected':''}>실제로 새 공식 예약을 완료함</option><option value="existing"${plan.mode==='existing'?' selected':''}>기존 예약으로 신청</option></select></label>
    <label>BRG 보상<select name="reward"><option value="discount"${plan.reward==='discount'?' selected':''}>요금 매칭 + 추가 객실료 할인</option><option value="points"${plan.reward==='points'?' selected':''}>요금 매칭 + 5,000 Bonvoy 포인트</option></select></label>
    <p>포인트는 원화·유로 절감액에 합산하지 않습니다. 보상은 공식 신청 제출 전 확정하세요.</p>
    <label>호텔 표준 체크인 시각 · ${esc(stay.timeZone??'현지 시간대 확인 필요')}<input type="time" name="checkInTime" value="${esc(prefs.checkInTime??'')}"></label>
    <div class="completed-booking"${plan.mode==='plan'?' hidden':''}>
    <label>신청할 예약의 실제 예약 시각 · 한국시간<input type="datetime-local" name="reservedAt" value="${esc(prefs.reservedAt?new Date(prefs.reservedAt).toLocaleString('sv-SE',{timeZone:'Asia/Seoul'}).slice(0,16).replace(' ','T'):'')}"></label>
    <label>신청할 예약의 전체 세전 객실료 · ${esc(c)}<input name="reservedRoomAmount" inputmode="decimal" type="number" min="0.01" step="0.01" value="${esc(prefs.reservedRoomAmount??'')}"></label>
    <label class="check-label"><input name="bookingConfirmed" type="checkbox"${checked(prefs.bookingConfirmed)}>공식 직접 예약·본보이 연결·동일 객실/혜택/취소조건 최저요금으로 예약한 것을 확인했습니다.</label>
    </div>
    <button type="submit">검토 기준 적용</button><button type="button" class="reset-plan">이 브라우저 설정 초기화</button><output class="plan-message" aria-live="polite"></output>
   </form>
  </details>`;
  root.querySelector('.plan-primary').addEventListener('click',()=>{draw();const d=root.querySelector('.claim-details');d.open=true;d.scrollIntoView({block:'nearest',behavior:'smooth'});});
  root.querySelector('[name=offer]')?.addEventListener('change',e=>{chosen=e.target.value;draw();root.querySelector('.claim-details').open=true;});
  const form=root.querySelector('.plan-form');
  form.addEventListener('input',()=>{form.dataset.dirty='true';});
  form.elements.mode.addEventListener('change',()=>{form.querySelector('.completed-booking').hidden=form.elements.mode.value==='plan';form.elements.reservedAt.value='';form.elements.reservedRoomAmount.value='';form.elements.bookingConfirmed.checked=false;});
  form.addEventListener('submit',e=>{
   e.preventDefault();const mode=form.elements.mode.value,stamp=form.elements.reservedAt.value;
   if(mode!=='plan'&&(!stamp||!form.elements.bookingConfirmed.checked)){form.querySelector('.plan-message').textContent='실제 예약 시각과 공식 예약 확인이 필요합니다.';return;}
   const reservedAt=stamp?new Date(stamp+':00+09:00').toISOString():null;
   if(mode!=='plan'&&(Date.parse(reservedAt)>Date.now()||!Number.isFinite(Number(form.elements.reservedRoomAmount.value))||Number(form.elements.reservedRoomAmount.value)<=0)){form.querySelector('.plan-message').textContent='예약 시각은 현재 이전이어야 하며 실제 세전 객실료를 입력해야 합니다.';return;}
   prefs={scope:reservationScope(stay),mode,reward:form.elements.reward.value,checkInTime:form.elements.checkInTime.value,reservedAt,reservedRoomAmount:form.elements.reservedRoomAmount.value?Number(form.elements.reservedRoomAmount.value):null,bookingConfirmed:form.elements.bookingConfirmed.checked};
   let persisted=true;try{localStorage.setItem(key(stay),JSON.stringify(prefs));}catch{persisted=false;}
   draw();root.querySelector('.plan-settings').open=true;root.querySelector('.plan-message').textContent=persisted?'이 브라우저에 저장했습니다.':'브라우저 저장이 불가해 이번 화면에만 적용했습니다.';
  });
  root.querySelector('.reset-plan').addEventListener('click',()=>{try{localStorage.removeItem(key(stay));}catch{}prefs={};chosen=null;draw();});
  root.querySelector('.copy-packet').addEventListener('click',async()=>{
   const latest=evaluatePlan(view,prefs),selected=latest.offers.find(o=>o.seller.name===chosen)??latest.best;
   const textarea=root.querySelector('.packet textarea');textarea.value=claimPacket(latest,selected);
   try{await navigator.clipboard.writeText(textarea.value);root.querySelector('.copy-result').textContent='복사했습니다. 공식 접수 전 미확인 항목을 확인하세요.';}catch{textarea.focus();textarea.select();root.querySelector('.copy-result').textContent='자동 복사가 불가합니다. 선택된 내용을 직접 복사하세요.';}
  });
  onChange(plan);
 }
 draw();
 setInterval(()=>{
  if(document.hidden||root.matches(':focus-within')||root.querySelector('.plan-form')?.dataset.dirty==='true')return;
  const open=[...root.querySelectorAll('details')].map(d=>d.open);draw();root.querySelectorAll('details').forEach((d,i)=>d.open=open[i]??false);
 },60000);
}

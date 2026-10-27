const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(n,c)=>Number.isFinite(n)?new Intl.NumberFormat('ko-KR',{style:'currency',currency:c,maximumFractionDigits:c==='JPY'?0:2}).format(n):'미확인';
const time=t=>t&&!Number.isNaN(Date.parse(t))?new Date(t).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+' 한국시간':'미확인';
export function sourceFactRows(source,stay){
 const f=source?.facts??{},p=f.price;
 return [
  {key:'hotel',label:'호텔',ok:f.hotelId===stay.id,value:f.hotelId===stay.id?stay.hotel:'미확인'},
  {key:'dates',label:'일정·인원·객실 수',ok:Boolean(f.search),value:f.search?`${f.search.checkIn} ~ ${f.search.checkOut} · 성인 ${f.search.adults} · 아동 ${f.search.children} · 객실 ${f.search.rooms}`:'미확인'},
  {key:'room',label:'객실 이름·침대 대응',ok:Boolean(f.roomIdentity),value:f.roomIdentity??(f.bedMatched?'침대 확인 · 객실 이름 대응 추가 확인':'미확인')},
  {key:'inclusions',label:'포함 혜택',ok:f.inclusions?.breakfast!=null,value:f.inclusions?.breakfast===false?'조식 미포함':f.inclusions?.breakfast===true?'조식 포함':'미확인'},
  {key:'cancellation',label:'무료취소 마감',ok:Boolean(f.cancellation?.freeUntil),value:f.cancellation?.freeUntil?`호텔 현지 ${new Date(f.cancellation.freeUntil).toLocaleString('ko-KR',{timeZone:stay.timeZone,year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})} (${stay.timeZone}) / ${time(f.cancellation.freeUntil)}`:'정확한 시각 미확인'},
  {key:'penalty',label:'마감 후 위약금',ok:Boolean(f.cancellation?.penalty)&&(f.cancellation.penalty.taxesIncluded!=null||f.cancellation.penalty.kind==='fixed-amount'),value:f.cancellation?.penalty?.kind==='fixed-amount'?`${money(f.cancellation.penalty.amount,f.cancellation.penalty.currency)} · 세금 포함 범위 확인 필요`:f.cancellation?.penalty?.kind==='first-night'?`첫 1박${f.cancellation.penalty.taxesIncluded===true?' + 세금·수수료':' · 세금 적용 확인 필요'}`:f.cancellation?.penalty?.kind==='full-stay'?'전체 숙박 요금 · 세금 적용 확인 필요':'미확인'},
  {key:'payment',label:'결제·보증',ok:Boolean(f.payment),value:f.payment?.timing==='property'?'현장 결제 · 카드 보증':'미확인'},
  {key:'price',label:'세전·세금·총액',ok:p?.preTaxVerified===true,value:p?.preTaxVerified?`${money(p.preTaxAmount,stay.booked.currency)} + ${money(p.taxesAndFees,stay.booked.currency)} = ${money(p.knownPayableTotal??p.totalAmount,stay.booked.currency)}`:f.priceObserved?.totalAmount?`관측 총액 ${money(f.priceObserved.totalAmount,stay.booked.currency)} · 별도 표시 세금 ${money(f.priceObserved.listedTaxesAndFees,stay.booked.currency)} · VAT 분리 추가 확인`:'선택 요금의 세금 제외 근거 확인 필요'},
  {key:'public',label:source?.provider==='Marriott'?'동일조건 최저 공개 요금':'공개 요금·제한 확인',ok:source?.provider==='Marriott'?f.lowestPublicRateVerified===true:f.publicRate===true&&f.restrictionsChecked===true,value:source?.provider==='Marriott'?(f.lowestPublicRateVerified?'같은 변경 가능 요금의 회원·일반 요금 확인':f.lowerRefundableDisplayAmounts?.length?`더 낮은 무료취소 표시가 ${f.lowerRefundableDisplayAmounts.map(n=>money(n,stay.booked.currency)).join(', ')} · 포함 혜택 대조 필요`:'미확인'):(f.publicRate===true&&f.restrictionsChecked===true?'로그인 없이 선택 요금·결제 단계 확인':f.publicRate===false?'공개 요금 조건 불충족':'미확인')},
  {key:'available',label:'선택 요금 예약 가능',ok:f.availabilityVerified===true,value:f.availabilityVerified===true?'미확정 요금 선택 단계 확인 · 예약 미실행':'미확인'}
 ];
}
const stateText={matched:'일치',mismatched:'불일치',unknown:'추가 확인'};
export function precisionHtml(view){
 const p=view.precision;if(!p)return '';
 const sources=[p.official,...p.offers],comparison=p.comparisons?.find(c=>c.provider===view.sellers.find(s=>s.rate?.source==='direct-precision')?.name)??p.comparisons?.[0];
 const matched=comparison?.checks?.filter(c=>c.state==='matched').length??0,total=comparison?.checks?.length??0;
 const mismatch=comparison?.checks?.filter(c=>c.state==='mismatched').map(c=>c.label).join(' · ');
 return `<details class="precision-details"><summary>정밀 자동검증 · ${mismatch?esc(mismatch)+' 불일치':`${matched}/${total}개 일치`}${p.fresh?'':' · 현재가 재확인'}</summary><p>검증 시각 ${esc(time(p.capturedAt))}. 일치 항목 수만으로 신청 가능하다는 뜻은 아닙니다.</p>
 ${sources.map(source=>{const rows=sourceFactRows(source,view.stay);return `<section class="precision-source"><h4>${esc(source.provider??'Marriott')} · ${rows.filter(r=>r.ok).length}/${rows.length}개 근거 확인</h4><p>${esc(time(source.capturedAt))} 확인${source.state==='property-link-unavailable'?' · 해당 판매처의 호텔 연결 확인 필요':source.status==='error'?' · 이번 상세 조회 미완료':''}</p><ul>${rows.map(r=>`<li class="${r.ok?'ok':'pending'}"><b>${r.ok?'확인':'추가 확인'}</b> ${esc(r.label)}<small>${esc(r.value)}</small></li>`).join('')}</ul></section>`;}).join('')}
 ${comparison?`<h4>양쪽 조건 대조</h4><ul>${comparison.checks.map(c=>`<li class="${c.state==='matched'?'ok':'pending'}"><b>${esc(stateText[c.state]??'추가 확인')}</b> ${esc(c.label)}</li>`).join('')}</ul>`:''}
 <p>공식 표시가를 세전가로 추정하거나, 침대만 같다는 이유로 객실을 같은 것으로 처리하지 않습니다. BRG 승인 후 Marriott 세금은 별도 근거가 있어야 확정 계산합니다.</p></details>`;
}

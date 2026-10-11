import { auditGoogleOffer, threshold, verifiedPreTaxAmount, reviewProviders, providerName, screenAllInOffer } from "./brg.js";
import { latestSuccessfulMarriott, marriottStatusLabel } from "./marriott-status.js";
import { sourceState } from './collection-state.js';
const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const money = (amount, currency) => new Intl.NumberFormat("ko-KR", {
  style: "currency", currency, maximumFractionDigits: currency === "JPY" ? 0 : 2
}).format(amount);
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]
));
const candidateOf = (result) => result && (result.exactCandidate ?? result.freeCancellation ?? result.lowestProvider);
const marriottOf = (result) => {
  const rate = result?.marriott;
  return rate?.status === "ok" &&
    rate.prepaid === false &&
    rate.amountBasis === "pre-tax" &&
    /Member Flexible Rate/i.test(rate.rateName ?? "")
    ? rate
    : null;
};
const dayKey = (value) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date(value));

function fxRate(run, currency) {
  return run?.fx?.rates?.[currency] ?? (currency === "EUR" ? run?.fx?.rate : null);
}

function localAmount(candidate, stay, run) {
  if (Number.isFinite(candidate?.totalAmount)) return candidate.totalAmount;
  const rate = fxRate(run, stay.booked.currency);
  return Number.isFinite(candidate?.totalKrw) && rate ? candidate.totalKrw / rate : null;
}

function estimatedAllIn(amount, stay) {
  if (!Number.isFinite(amount)) return null;
  return amount; // Never add estimated taxes to a rate with an unknown tax basis.
}

function krwAmount(candidate, stay, run) {
  if (Number.isFinite(candidate?.totalKrw)) return candidate.totalKrw;
  const rate = fxRate(run, stay.booked.currency);
  return Number.isFinite(candidate?.totalAmount) && rate ? Math.round(candidate.totalAmount * rate) : null;
}

function latestCandidate(runs, stayId, beforeIndex = runs.length) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const result = runs[index].results?.find((item) => item.id === stayId);
    if (result?.status === "ok" && candidateOf(result)) return { result, run: runs[index], index };
  }
  return null;
}

function latestMarriott(runs, stayId, beforeIndex = runs.length) {
  return latestSuccessfulMarriott(runs.slice(0, beforeIndex), stayId, marriottOf);
}

function previousDayCandidate(runs, stayId, sourceIndex, sourceCapturedAt) {
  const sourceDay = dayKey(sourceCapturedAt);
  for (let index = sourceIndex - 1; index >= 0; index -= 1) {
    if (dayKey(runs[index].capturedAt) === sourceDay) continue;
    const result = runs[index].results?.find((item) => item.id === stayId);
    if (result?.status === "ok" && candidateOf(result)) return { result, run: runs[index], index };
  }
  return null;
}

function dailySeries(runs, stay) {
  const byDay = new Map();
  runs.forEach((run) => {
    const result = run.results?.find((item) => item.id === stay.id);
    const candidate = candidateOf(result);
    const googleAmount = verifiedPreTaxAmount(candidate, stay.booked.currency);
    const marriottAmount = estimatedAllIn(marriottOf(result)?.totalAmount, stay);
    const day = dayKey(run.capturedAt);
    const previous = byDay.get(day) ?? { day };
    if (result?.status === "ok" && Number.isFinite(googleAmount)) previous.googleAmount = googleAmount;
    if (Number.isFinite(marriottAmount)) previous.marriottAmount = marriottAmount;
    if (Number.isFinite(previous.googleAmount) || Number.isFinite(previous.marriottAmount)) byDay.set(day, previous);
  });
  return [...byDay.values()].slice(-60);
}

function chartMarkup(series, stay) {
  if (!series.length) return '<div class="chart empty-chart">그래프를 만들 가격 기록이 없습니다.</div>';
  const width = 340;
  const height = 130;
  const pad = { left: 12, right: 12, top: 16, bottom: 24 };
  const booked = stay.booked.roomSubtotal;
  const googleValues = series.map((point) => point.googleAmount).filter(Number.isFinite);
  const marriottValues = series.map((point) => point.marriottAmount).filter(Number.isFinite);
  const values = [...googleValues, ...marriottValues, booked];
  let min = Math.min(...values);
  let max = Math.max(...values);
  const gap = max - min || Math.max(1, max * 0.05);
  min -= gap * 0.15;
  max += gap * 0.15;
  const x = (index) => series.length === 1
    ? width / 2
    : pad.left + index * ((width - pad.left - pad.right) / (series.length - 1));
  const y = (value) => pad.top + ((max - value) / (max - min)) * (height - pad.top - pad.bottom);
  const line = (key, css) => {
    const available = series.map((point, index) => ({ point, index })).filter(({ point }) => Number.isFinite(point[key]));
    const points = available.map(({ point, index }) => `${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");
    const circles = available.map(({ point, index }) => `<circle class="${css}-dot" cx="${x(index).toFixed(1)}" cy="${y(point[key]).toFixed(1)}" r="4"><title>${point.day} ${money(point[key], stay.booked.currency)}</title></circle>`).join("");
    return `${available.length > 1 ? `<polyline class="${css}-line" points="${points}"></polyline>` : ""}${circles}`;
  };
  return `<div class="chart">
    <div class="chart-head"><b>일별 수집 가격 추이 · 세금 기준 구분</b><span>${series.length}일 기록 · ${stay.booked.currency} 기준</span></div>
    <div class="chart-legend"><span class="booked-key">내 예약 객실료(세금 제외)</span><span class="google-key">Google 표시 총액(최신: 세금 포함)</span><span class="marriott-key">Marriott 공식 객실료(세금 제외)</span></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(stay.hotel)} 일별 가격 비교 그래프">
      <line class="baseline" x1="${pad.left}" x2="${width - pad.right}" y1="${y(booked).toFixed(1)}" y2="${y(booked).toFixed(1)}"><title>예약가 ${money(booked, stay.booked.currency)}</title></line>
      ${line("googleAmount", "google")}${line("marriottAmount", "marriott")}
      <text x="${pad.left}" y="${height - 5}">${series[0].day.slice(5)}</text>
      <text x="${width - pad.right}" y="${height - 5}" text-anchor="end">${series.at(-1).day.slice(5)}</text>
    </svg>
    <div class="chart-caption"><span>그래프는 모두 세금 제외 · Google 확인 세전 기록만 표시</span><span>Google ${googleValues.length ? money(Math.min(...googleValues), stay.booked.currency) : "세전 확인 기록 없음"} · Marriott ${marriottValues.length ? money(Math.min(...marriottValues), stay.booked.currency) : "기록 없음"}</span></div>
  </div>`;
}

function candidateState(result, stale) {
  if (result.dateConfirmed !== true || result.occupancyConfirmed !== true) return '검색조건 미검증 · 참고 가격';
  if (stale) return "최근 유효 결과";
  if (result.candidateKind === "exact") return "객실명 일치 · 조건 확인 필요";
  if (result.candidateKind === "free-cancel-review") return "무료취소·객실조건 확인";
  return "헤드라인가·수동 확인";
}

function googleOpportunityMarkup(audit, candidate, official, currency) {
  if (!audit?.lowerThanOfficial) return "";
  const blockerLabels = audit.blockers.slice(0, 5).map((blocker) => `<span>${esc(blocker.label)}</span>`).join("");
  const more = audit.blockers.length > 5 ? `<span>+${audit.blockers.length - 5}개</span>` : "";
  const priceText = audit.pass
    ? `내 예약 BRG 가격 상한 ${money(audit.max, currency)} 이하 · 가격 차이 충족`
    : `내 예약 BRG 가격 상한 ${money(audit.max, currency)} 초과 · 신청 가격 기준 미달`;
  const conflictText = audit.evidence.excludedMatches.length
    ? `<p class="google-conflict">객실 충돌 감지: ${esc(audit.evidence.excludedMatches.join(", "))}</p>`
    : "";
  return `<section class="google-opportunity ${audit.pass ? "price-pass" : "price-fail"}" aria-label="Google 저가 정밀 판정">
    <div class="google-opportunity-head"><div><span class="google-kicker">GOOGLE LOWER RATE</span><h3>Google 검증 후보가 Marriott 공식 현행가보다 낮습니다</h3></div><strong>-${money(audit.officialDifference, currency)} <small>${audit.officialDifferencePercent.toFixed(1)}%</small></strong></div>
    <div class="google-rate-flow"><b>${money(official.totalAmount, currency)}<small>Marriott 공식 세전</small></b><i>→</i><b>${money(audit.comparisonAmount, currency)}<small>Google 확인 세전 총액</small></b></div>
    <p class="google-price-verdict ${audit.pass ? "pass" : "fail"}">${esc(priceText)}</p>
    <p class="google-audit-status">${esc(audit.status)}</p>${conflictText}
    ${audit.blockers.length ? `<div class="google-blockers"><b>미확인·불일치</b>${blockerLabels}${more}</div>` : `<p class="google-verified">가격·조건 자동검증 완료</p>`}
    <small>Google 표시가가 낮다는 사실과 BRG 적격은 다릅니다. 아래 조건과 결제 직전 총액이 모두 확인돼야 신청 후보입니다.</small>
  </section>`;
}


function otaReviewMarkup(stay, result, official, stale, officialStale, attempts = []) {
  const rates = [...(result.providers ?? []), ...(result.roomRates ?? []), candidateOf(result)].filter(Boolean);
  const rows = reviewProviders.map(provider => {
    const matches = rates.filter(rate => providerName(rate.provider) === provider && rate.currency === stay.booked.currency &&
      Number.isFinite(rate.totalAmount) && rate.totalAmount > 0 && rate.estimatedFromNightly !== true);
    const rate = matches.sort((a,b) => a.totalAmount - b.totalAmount || (b.context?.length ?? 0) - (a.context?.length ?? 0))[0];
    const screen = screenAllInOffer({stay, result, candidate:rate, official, stale, officialStale});
    const audit = auditGoogleOffer({stay, result, candidate:rate, official, stale});
    const caution = audit.evidence.excludedMatches.length ? `객실 불일치 단서: ${audit.evidence.excludedMatches.join(', ')}` :
      !audit.evidence.cancellationMatched ? '동일 취소기한 미확인' : !audit.evidence.roomMatched ? '동일 객실·침대 미확인' : '실제 예약 가능 여부 미확인';
    const status = !rate ? 'Google 가격 목록에서 미관측 · 판매처 직접 확인 필요' : stale ? '과거 수집 · 재조회 필요' :
      screen.priority ? `총액도 객실료보다 낮음 · 우선 확인${screen.bookedPriceMargin ? ' · 내 예약 대비 1% 초과 차이' : ''}` :
      '세전·동일 객실·취소조건 확인 필요';
    const basis = rate?.amountBasis === 'tax-included' ? '세금·수수료 포함 표시 총액' : rate?.amountBasis === 'pre-tax' ? '세금 제외 객실료' : '금액 기준 미확인';
    const scope=JSON.stringify([stay.checkIn,stay.checkOut,stay.adults,stay.booked.currency,stay.booked.room,stay.booked.cancellationDeadline]);
    const direct = attempts.find(x=>x.provider===provider&&(!x.scope||x.scope===scope));
    const labels = {'blocked':'사람 확인/접근 차단','link-unavailable':'실제 연결 링크 미확인','unexpected-destination':'판매처 연결 목적지 불일치','hotel-unverified':'호텔 확인 실패',
      'search-conditions-unverified':'날짜·인원·객실 수 미확인','room-or-cancellation-unverified':'선택 객실·취소기한 미확인','public-rate-unverified':'공개 요금 미확인',
      'price-breakdown-unverified':'세금·수수료 상세 미확인','selected-offer-unverified':'선택 요금 미확인','navigation-timeout':'연결 시간 초과','navigation-failed':'연결 실패','empty-page':'빈 화면',
      'tab-unavailable':'전용 Chrome 판매처 탭 미확인','tab-read-failed':'전용 Chrome 화면 읽기 실패',
      'search-timeout':'날짜·인원 설정 시간 초과','search-failed':'날짜·인원 설정 실패','date-selection-unverified':'선택 날짜 미확인',
      'occupancy-selection-required':'인원 설정 변경 필요','search-link-unverified':'판매처 검색 링크 미확인','date-unavailable':'선택 날짜 조회 불가','room-selection-timeout':'동일 객실 선택 시간 초과','room-selection-failed':'동일 객실 선택 실패','matching-offer-unavailable':'동일 객실·취소조건 요금 없음'};
    const freshDirect = direct && Date.now()-Date.parse(direct.capturedAt)<=86400000;
    const directText = direct?.status==='ok' && freshDirect ? `판매처 확인 객실료 ${money(direct.roomAmount,stay.booked.currency)} · 세금 제외 · 예약 가능 여부 최종 확인 필요` :
      direct ? `판매처 직접 확인: ${labels[direct.state]??'확인 보류'}${freshDirect?'':' · 24시간 경과'}${direct.lastSuccessful?` · 직전 성공 객실료 ${money(direct.lastSuccessful.roomAmount,stay.booked.currency)} (현재 재확인 필요)`:''}` : '판매처 직접 확인: 아직 조회하지 않음';
    return `<li class="${screen.priority ? 'ota-priority' : ''}"><b>${provider}</b><span>${rate ? `${money(rate.totalAmount, rate.currency)} · ${basis}` : '가격 미확인'}</span><small>${esc(status)}${rate ? ` · ${esc(caution)}` : ''}</small><small class="ota-direct">${esc(directText)}</small></li>`;
  }).join('');
  return `<section class="ota-review" aria-label="주요 OTA 우선 확인"><h3>Booking.com · Agoda · Expedia</h3><p>Google에서 관측한 숙박 전체 표시가입니다. 세금·수수료 포함 총액도 객실료보다 낮으면 우선 확인 대상으로 표시합니다.</p><ul>${rows}</ul><small>우선 확인은 BRG 승인 확률이나 확정 판정이 아닙니다. 판매처 가격 상세는 읽기 전용으로 확인하며 예약·결제는 진행하지 않습니다. 차단·미확인 결과는 세전가로 확정하지 않습니다.</small></section>`;
}
function brgMarkup(stay, result, sourceRun, stale, googleAudit = null) {
  const base = stay.booked.roomSubtotal;
  const currency = stay.booked.currency;
  const limit = threshold(base, currency);
  const rates = result.roomRates?.length ? result.roomRates : result.providers ?? [];
  const basisLabel = (rate) => rate.preTaxVerified === true || rate.amountBasis === "pre-tax"
    ? "세전 확인"
    : rate.amountBasis === "tax-included"
      ? "세금·수수료 포함"
      : "세금 기준 미확인";
  const rows = rates.map(rate => `<tr><td>${esc(rate.provider ?? rate.context ?? "판매가")}</td><td>${money(rate.totalAmount, rate.currency ?? currency)}</td><td>${basisLabel(rate)}</td><td>${rate.preTaxVerified === true || rate.amountBasis === "pre-tax" ? "세전 비교 가능" : "세전 분리 필요"}${stale ? " · 과거 기록" : ""}</td></tr>`).join("");
  const evidenceUrl = result.detailUrl ?? result.searchUrl ?? "#";
  const check = (key, yes, no = "확인 필요") => {
    const item = googleAudit?.checks.find((candidate) => candidate.key === key);
    return item?.ok === true ? yes : no;
  };
  const eligibility = [
    ["동일 호텔", stay.hotel ? "대상 호텔 고정" : "확인 필요"],
    ["동일 체크인·체크아웃", check("dates", `${stay.checkIn} → ${stay.checkOut} · 수집 화면 확인`, `${stay.checkIn} → ${stay.checkOut} · 화면 날짜 재확인 필요`)],
    ["동일 숙박일수", check("nights", `${Math.round((Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / 86400000)}박 일치`, "숙박일수 확인 필요")],
    ["동일 투숙 인원", check("occupancy", `성인 ${stay.adults}명 조회 일치`, `성인 ${stay.adults}명 · 원문 확인 필요`)],
    ["동일 객실 및 침대", check("room", "객실명·침대 패턴 일치", googleAudit?.evidence.excludedMatches.length ? `불일치 패턴 감지: ${googleAudit.evidence.excludedMatches.join(", ")}` : "확인 필요")],
    ["동일 포함 혜택", "확인 필요"],
    ["동일 취소·환불 조건", check("cancellation", `무료취소 기한 ${googleAudit?.evidence.offeredDeadline ?? "일치"}`, "무료취소 기한 불일치 또는 미확인")],
    ["세금·수수료 기준", check("basis", "세금·수수료 제외 총액 확인", "Google 금액의 세전/세후 기준 미확인")],
    ["누구나 예약 가능한 공개 요금", check("public", "공개 요금 확인", "로그인·쿠폰·앱·특수자격 여부 확인 필요")],
    ["실제 예약 가능 여부", check("available", "결제 직전 예약 가능 확인", "결제 직전 화면 확인 필요")],
    ["내 예약 대비 가격 차이", googleAudit?.pass ? `${money(googleAudit.difference, currency)} 낮음 · 1% 초과` : Number.isFinite(googleAudit?.difference) ? `${money(Math.abs(googleAudit.difference), currency)} ${googleAudit.difference >= 0 ? "낮지만 1% 이하" : "높음"}` : "비교 금액 확인 필요"],
    ["증빙 URL", evidenceUrl === "#" ? "없음" : `<a href="${esc(evidenceUrl)}" target="_blank" rel="noreferrer">원문 열기</a>`],
    ["확인 시각", new Date(sourceRun.capturedAt).toLocaleString("ko-KR")]
  ].map(([label, value]) => `<li><b>${esc(label)}</b><span>${label === "증빙 URL" ? value : esc(value)}</span></li>`).join("");
  const thresholdState = googleAudit?.pass && googleAudit?.verified
    ? { label: "신청 후보", css: "ready" }
    : googleAudit?.pass
      ? { label: "가격 충족 · 조건 확인", css: "review" }
      : Number.isFinite(googleAudit?.comparisonAmount)
        ? { label: "가격 기준 미달", css: "failed" }
        : { label: "세전가 확인 필요", css: "pending" };
  return `<section class="brg-panel" aria-label="${esc(stay.displayName ?? stay.hotel)} BRG 판정">
    <div class="brg-threshold">
      <div><span>BRG 신청 상한 <em>세전</em></span><b>${money(limit.max, currency)}</b><small>내 예약 세전 객실료 ${money(base, currency)} 기준</small></div>
      <strong class="threshold-state ${thresholdState.css}">${thresholdState.label}</strong>
    </div>
    <details><summary>수집 요금 ${rates.length}개 보기</summary><div class="rate-scroll"><table><thead><tr><th>객실·판매처</th><th>Google 표시 금액</th><th>금액 기준</th><th>BRG</th></tr></thead><tbody>${rows}</tbody></table></div><p class="detail-note">${new Date(sourceRun.capturedAt).toLocaleString("ko-KR")} 수집 · 객실명만으로 침대·혜택·취소조건 일치를 보장하지 않습니다.</p></details>
    <details><summary>조건별 판정 확인</summary><ul class="eligibility">${eligibility}</ul></details>
  </section>`;
}

async function render() {
  const response = await fetch(`data.json?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`데이터 요청 실패 (HTTP ${response.status})`);
  const data = await response.json();
  const runs = Array.isArray(data.runs) ? data.runs : [];
  const run = runs[runs.length - 1];
  const stays = data.config?.stays ?? [];
  const collectorStatus = data.collectorStatus;

  const lastSuccessRun = [...runs].reverse().find((candidate) =>
    candidate.results?.some((result) => result.status === "ok" || result.marriott?.status === "ok")
  );
  const latestFailedCount = [collectorStatus, data.googleStatus].reduce((count, status) => count + (status?.results?.filter(result => result.status !== 'ok' && result.status !== 'excluded' && result.status !== 'not-collected').length ?? 0), 0);
  const lastAttemptAt = [collectorStatus?.capturedAt, run?.capturedAt]
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  document.querySelector("#updated").textContent = run
    ? `마지막 시도 ${new Date(lastAttemptAt).toLocaleString("ko-KR")} · ${lastSuccessRun ? `마지막 성공 ${new Date(lastSuccessRun.capturedAt).toLocaleString("ko-KR")}` : "성공 기록 없음"}${latestFailedCount ? ` · 이번 실패 ${latestFailedCount}건` : ""}`
    : "아직 수집 기록 없음";
  if (!run) {
    document.querySelector("#cards").innerHTML = '<article class="empty">아직 수집 기록이 없습니다.</article>';
    return;
  }

  const displayed = stays.map((stay) => {
    const current = run.results?.find((result) => result.id === stay.id);
    const currentCandidate = candidateOf(current);
    const fallback = currentCandidate ? null : latestCandidate(runs, stay.id, runs.length - 1);
    return {
      stay,
      current,
      sourceResult: currentCandidate ? current : fallback?.result,
      sourceRun: currentCandidate ? run : fallback?.run,
      sourceIndex: currentCandidate ? runs.length - 1 : fallback?.index,
      stale: (!currentCandidate && Boolean(fallback)) || (Date.now() - Date.parse((currentCandidate ? run : fallback?.run)?.capturedAt) > 86400000)
    };
  });
  const todayCandidateCount = displayed.filter((item) => (
    candidateOf(item.sourceResult) && item.sourceResult.dateConfirmed === true && item.sourceResult.occupancyConfirmed === true && dayKey(item.sourceRun.capturedAt) === dayKey(new Date())
  )).length;
  const todayMarriottCount = stays.filter((stay) => {
    const result = run.results?.find((item) => item.id === stay.id);
    const currentRate = marriottOf(result);
    const fallback = currentRate ? null : latestMarriott(runs, stay.id);
    const sourceRun = currentRate ? run : fallback?.run;
    return Boolean(currentRate ?? fallback?.rate) && dayKey(sourceRun?.capturedAt) === dayKey(new Date());
  }).length;
  const shownCount = displayed.filter((item) => candidateOf(item.sourceResult)).length;
  const googleAudits = displayed.map((item) => {
    const official = marriottOf(item.current) ?? latestMarriott(runs, item.stay.id)?.rate;
    const candidate = candidateOf(item.sourceResult);
    return auditGoogleOffer({
      stay: item.stay,
      result: item.sourceResult,
      candidate,
      official,
      stale: item.stale
    });
  });
  const googleLowerCount = googleAudits.filter((audit) => audit.lowerThanOfficial).length;
  const googlePricePassCount = googleAudits.filter((audit) => audit.lowerThanOfficial && audit.pass).length;
  const googlePreTaxVerifiedCount = displayed.filter((item) => candidateOf(item.sourceResult)?.preTaxVerified === true || candidateOf(item.sourceResult)?.amountBasis === "pre-tax").length;
  const marriottDropCount = stays.filter((stay) => {
    const current = run.results?.find((item) => item.id === stay.id);
    const latestRate = marriottOf(current) ?? latestMarriott(runs, stay.id)?.rate;
    return Number.isFinite(latestRate?.totalAmount) && latestRate.totalAmount < stay.booked.roomSubtotal - 0.005;
  }).length;
  const rates = run.fx?.rates ?? (run.fx?.rate ? { EUR: run.fx.rate } : {});
  const fxText = Object.entries(rates)
    .map(([currency, rate]) => `1 ${currency}=${Number(rate).toFixed(currency === "JPY" ? 2 : 1)}원`)
    .join(" · ") || "환율 없음";
  document.querySelector("#summary").innerHTML = `
    <div><b>${shownCount}/${stays.length}</b><span>결과 표시</span></div>
    <div><b>${todayCandidateCount}/${stays.length}</b><span>Google 오늘 조건 검증 가격</span></div>
    <div><b>${todayMarriottCount}/${stays.length}</b><span>Marriott 오늘 가격</span></div>
    <div class="summary-pretax"><b>${googlePreTaxVerifiedCount}/${stays.length}</b><span>Google 세전 금액 확인</span></div>
    <div class="summary-google"><b>${googleLowerCount}곳</b><span>Google가 공식 현행가보다 낮음</span></div>
    <div class="summary-opportunity"><b>${googlePricePassCount}곳</b><span>내 예약 대비 가격차 충족</span></div>
    <div class="summary-drop"><b>${marriottDropCount}곳</b><span>Marriott 공식 객실료 인하</span></div>
    <div class="summary-fx"><b>${esc(fxText)}</b><span>원화는 참고 환산만</span></div>`;

  document.querySelector("#cards").innerHTML = displayed.map(({ stay, current, sourceResult, sourceRun, sourceIndex, stale }) => {
    const sourceWarnings = [['google', data.googleStatus, 'Google'], ['marriott', collectorStatus, 'Marriott']].map(([source, attempts, label]) => {
      const state = sourceState(runs, attempts, stay.id, source);
      const time = at => at ? new Date(at).toLocaleString('ko-KR') : '기록 없음';
      return `<p class="freshness">${label} · 마지막 시도 ${time(state.attemptedAt)} · 마지막 가격 수집 ${time(state.successAt)}${state.stale ? ' · 24시간 경과/성공 없음' : ''}${source === 'google' && !state.verified ? ' · 검색조건 미검증' : ''}${state.failed ? ` · 수집 실패: ${esc(state.error ?? '원인 미상')}` : ''}</p>`;
    }).join('');
    const attempt = collectorStatus?.results?.find((item) => item.id === stay.id);
    const attemptWarning = attempt?.status && attempt.status !== "ok"
      ? `<p class="freshness">${esc(marriottStatusLabel(attempt.state))}${attempt.capturedAt ? ` · ${new Date(attempt.capturedAt).toLocaleString("ko-KR")}` : ""}</p>`
      : "";
    if (!sourceResult) {
      const googleLink = current?.searchUrl ?? `https://www.google.com/travel/search?q=${encodeURIComponent(stay.hotel)}`;
      const marriottLink = `https://www.marriott.com/en-us/hotels/${stay.marriott.propertyCode.toLowerCase()}-${stay.marriott.slug}/rooms/`;
      return `<article class="card error">${sourceWarnings}
        <div class="card-head"><div><p>${stay.checkIn} → ${stay.checkOut}</p><h2>${esc(stay.displayName ?? stay.hotel)}</h2></div><span class="pill failed">수집 오류</span></div>
        ${attemptWarning}<p>${esc(current?.error ?? "표시할 가격 후보를 찾지 못했습니다.")}</p>
        ${chartMarkup([], stay)}
        ${brgMarkup(stay, current ?? {}, run, true)}
        <p class="room"><b>${esc(stay.booked.room)}</b><br>${esc(stay.booked.cancellation)} · ${esc(stay.booked.cancellationDeadline)}<br>예약 총액 ${money(stay.booked.total, stay.booked.currency)}</p>
        <div class="source-links"><a href="${esc(googleLink)}" target="_blank" rel="noreferrer">Google 후보 출처·조건 확인 →</a><a href="${esc(marriottLink)}" target="_blank" rel="noreferrer">Marriott 공식가·객실 확인 →</a></div>
      </article>`;
    }
    const today = candidateOf(sourceResult);
    const auditedToday = today;
    const todayRawAmount = localAmount(today, stay, sourceRun);
    const todayAmount = estimatedAllIn(todayRawAmount, stay);
    const state = candidateState(sourceResult, stale);
    const bookedCurrency = stay.booked.currency;
    const rate = fxRate(sourceRun, bookedCurrency);
    const currentMarriott = marriottOf(current);
    const marriottFallback = currentMarriott ? null : latestMarriott(runs, stay.id, runs.length - 1);
    const marriottRate = currentMarriott ?? marriottFallback?.rate;
    const marriottRun = currentMarriott ? run : marriottFallback?.run;
    const marriottRawAmount = marriottRate?.totalAmount;
    const marriottAmount = estimatedAllIn(marriottRawAmount, stay);
    const marriottFx = marriottRun ? fxRate(marriottRun, bookedCurrency) : null;
    const marriottKrw = Number.isFinite(marriottAmount) && marriottFx
      ? Math.round(marriottAmount * marriottFx)
      : null;
    const marriottStale = (!currentMarriott && Boolean(marriottFallback)) || (marriottRun && Date.now() - Date.parse(marriottRun.capturedAt) > 86400000);
    const marriottDifference = Number.isFinite(marriottRawAmount)
      ? stay.booked.roomSubtotal - marriottRawAmount
      : null;
    const marriottDifferencePercent = Number.isFinite(marriottDifference) && stay.booked.roomSubtotal > 0
      ? Math.abs(marriottDifference) / stay.booked.roomSubtotal * 100
      : null;
    const marriottPriceState = !Number.isFinite(marriottDifference)
      ? "unknown"
      : marriottDifference > 0.005
        ? "lower"
        : marriottDifference < -0.005
          ? "higher"
          : "same";
    const marriottDifferenceText = marriottPriceState === "lower"
      ? `내 예약 객실료보다 ${money(marriottDifference, bookedCurrency)} 낮음 (${marriottDifferencePercent.toFixed(1)}%)`
      : marriottPriceState === "higher"
        ? `내 예약 객실료보다 ${money(Math.abs(marriottDifference), bookedCurrency)} 높음 (${marriottDifferencePercent.toFixed(1)}%)`
        : marriottPriceState === "same"
          ? "내 예약 객실료와 동일"
          : "내 예약 객실료와 비교 불가";
    const marriottLink = marriottRate?.sourceUrl ?? current?.marriott?.sourceUrl ??
      `https://www.marriott.com/en-us/hotels/${stay.marriott.propertyCode.toLowerCase()}-${stay.marriott.slug}/rooms/`;
    const currentWarning = stale
      ? `<p class="freshness">최신 수집값이 비어 있어 ${new Date(sourceRun.capturedAt).toLocaleString("ko-KR")}의 최근 유효 결과를 표시합니다.</p>`
      : "";
    const googleAudit = auditGoogleOffer({ stay, result: sourceResult, candidate: auditedToday, official: marriottRate, stale });
    const googleIsTaxIncluded = today?.amountBasis === "tax-included";
    const googlePreTax = verifiedPreTaxAmount(auditedToday, bookedCurrency);
    const googlePreTaxLine = Number.isFinite(googlePreTax)
      ? `<small class="google-pretax confirmed">확인 세전 · ${esc(auditedToday.preTaxEvidence ?? '판매처 세전 표시')} · Google와 Marriott 동일 기준 비교</small>`
      : `<small class="google-pretax pending">판매처 세금·수수료 확인 필요 · 비교/BRG 판정 보류</small>`;
    return `<article class="card ${stale ? "stale" : ""} ${marriottPriceState === "lower" ? "has-rate-drop" : ""} ${googleAudit.lowerThanOfficial ? "has-google-opportunity" : ""}">
      <div class="card-head"><div><p>${stay.checkIn} → ${stay.checkOut}</p><h2>${esc(stay.displayName ?? stay.hotel)}</h2></div><span class="pill ${sourceResult.candidateKind === "exact" && !stale ? "match" : "review"}">${state}</span></div>
      ${sourceWarnings}
      ${currentWarning}${attemptWarning}${!marriottRate ? `<p class="freshness">공식가 확인 대기 · 최근 성공값을 보존하며 자동 조회 결과를 기다립니다.</p>` : ""}
      ${marriottPriceState === "lower" ? `<div class="rate-drop-alert"><strong>↓ Marriott 공식 객실료 인하</strong><span>${esc(marriottDifferenceText)} · 동일 취소조건인지 확인 후 예약 변경 검토</span></div>` : ""}
      ${googleOpportunityMarkup(googleAudit, auditedToday, marriottRate, bookedCurrency)}
      ${otaReviewMarkup(stay, sourceResult, marriottRate, stale, marriottStale, data.otaStatus?.results?.find(x=>x.id===stay.id)?.providers ?? sourceResult.otaChecks ?? [])}
      <div class="prices three"><div class="booked-price"><span>내 예약 객실료 <em>세금 제외</em></span><b>${money(stay.booked.roomSubtotal, bookedCurrency)}</b><small class="comparison-basis">BRG 비교 기준 객실료 · 세금 제외</small><small>참고: 내 예약 총액 ${money(stay.booked.total, bookedCurrency)} · 세금 포함</small><small>세금·요금 ${money(stay.booked.taxesAndFees, bookedCurrency)}</small></div><div class="google-price"><span>Google 확인 객실료 <em>세금 제외</em></span><b>${Number.isFinite(googlePreTax) ? money(googlePreTax, bookedCurrency) : '세전 확인 필요'}</b>${googlePreTaxLine}<small>참고: ${stale ? '최근' : '오늘'} Google 세금 포함 전체 총액 ${money(todayAmount, bookedCurrency)} · ${googleIsTaxIncluded ? 'Stay total' : '기존 금액 기준 재확인 필요'}</small></div><div class="official-price ${marriottPriceState}"><span>${marriottStale ? "최근 Marriott 공식 객실료" : "오늘 Marriott 공식 객실료"} <em>세금 제외</em></span><b>${Number.isFinite(marriottAmount) ? money(marriottAmount, bookedCurrency) : "자동 조회 불가"}</b><strong class="marriott-delta ${marriottPriceState}">${esc(marriottDifferenceText)}</strong><small>${marriottRate?.rateName ? `${esc(marriottRate.rateName)} · ${esc(marriottRate.cancellation ?? "무료취소")}` : "선불·비환불 요금은 비교에서 제외"}</small><small>${marriottKrw == null ? "원화 환산 없음" : `${won.format(marriottKrw)} 참고`} · ${marriottRun ? new Date(marriottRun.capturedAt).toLocaleString("ko-KR") : ""}</small></div></div>
      ${chartMarkup(dailySeries(runs, stay), stay)}
      <p class="room"><b>${esc(stay.booked.room)}</b><br>${esc(stay.booked.cancellation)} · ${esc(stay.booked.cancellationDeadline)}${stay.booked.status ? `<br><strong class="booking-status">${esc(stay.booked.status)}</strong>` : ""}<br>객실료 ${money(stay.booked.roomSubtotal, bookedCurrency)} + 세금·요금 ${money(stay.booked.taxesAndFees, bookedCurrency)}<br>${esc(stay.booked.note)}</p>
      ${brgMarkup(stay, sourceResult, sourceRun, stale, googleAudit)}
      <div class="source-links"><a href="${esc(sourceResult.detailUrl ?? current?.searchUrl ?? "#")}" target="_blank" rel="noreferrer">Google 후보 출처·조건 확인 →</a><a href="${esc(marriottLink)}" target="_blank" rel="noreferrer">Marriott 공식가·객실 확인 →</a></div>
    </article>`;
  }).join("");

}

render().catch((error) => {
  document.querySelector("#updated").textContent = "데이터 표시 오류";
  document.querySelector("#summary").innerHTML = "";
  document.querySelector("#cards").innerHTML = `<article class="card error"><h2>결과를 표시하지 못했습니다.</h2><p>${esc(error.message)}</p><button type="button" onclick="location.reload()">새로고침</button></article>`;
  console.error(error);
});

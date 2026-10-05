import { assess, auditGoogleOffer, threshold } from "./brg.js";
import { latestSuccessfulMarriott, marriottStatusLabel } from "./marriott-status.js";
const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const money = (amount, currency) => new Intl.NumberFormat("ko-KR", {
  style: "currency", currency, maximumFractionDigits: currency === "JPY" ? 0 : 2
}).format(amount);
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]
));
const enteredNumber = (value) => value == null || String(value).trim() === "" ? NaN : Number(value);
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

function estimatedPreTax(amount, stay) {
  if (!Number.isFinite(amount)) return null;
  const percent = Number(stay.allInEstimate?.percent ?? 0);
  const fixed = Number(stay.allInEstimate?.fixed ?? 0);
  if (percent === 0 && fixed === 0) return null;
  const value = (amount - fixed) / (1 + percent);
  if (!(value > 0)) return null;
  return stay.booked.currency === "JPY" ? Math.round(value) : Math.round(value * 100) / 100;
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
    const googleAmount = estimatedAllIn(localAmount(candidate, stay, run), stay);
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
    <div class="chart-caption"><span>최신 Google은 세금 포함 · 과거 기록은 금액 기준 혼합</span><span>Google ${googleValues.length ? money(Math.min(...googleValues), stay.booked.currency) : "기록 없음"} · Marriott ${marriottValues.length ? money(Math.min(...marriottValues), stay.booked.currency) : "기록 없음"}</span></div>
  </div>`;
}

function candidateState(result, stale) {
  if (stale) return "최근 유효 결과";
  if (result.candidateKind === "exact") return "객실명 일치 · 조건 확인 필요";
  if (result.candidateKind === "free-cancel-review") return "무료취소·객실조건 확인";
  return "헤드라인가·수동 확인";
}

function candidateWithVerifiedPreTax(stay, candidate) {
  if (!candidate) return candidate;
  const saved = savedQuote(stay.id);
  const observed = Number(candidate.totalAmount);
  const enteredTotal = enteredNumber(saved.googleTotal);
  const taxes = enteredNumber(saved.googleTaxes);
  const tolerance = stay.booked.currency === "JPY" ? 1 : 0.01;
  const reconciles = Number.isFinite(observed) && Number.isFinite(enteredTotal) && Number.isFinite(taxes) &&
    Math.abs(observed - enteredTotal) <= tolerance && taxes >= 0 && taxes < enteredTotal;
  return reconciles
    ? { ...candidate, preTaxAmount: enteredTotal - taxes, preTaxVerified: true, preTaxEvidence: "Google/OTA 결제단계 세금·수수료 입력 검산" }
    : candidate;
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


function savedQuote(id) {
  try { return JSON.parse(localStorage.getItem(`brg:${id}`)) ?? {}; } catch { return {}; }
}
function brgMarkup(stay, result, sourceRun, stale, googleAudit = null) {
  const saved = savedQuote(stay.id);
  const observedCandidate = candidateOf(result);
  const verifiedCandidate = candidateWithVerifiedPreTax(stay, observedCandidate);
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
  const verifiedOffer = verifiedCandidate?.preTaxVerified === true ? verifiedCandidate.preTaxAmount : enteredNumber(saved.offer);
  const manual = assess(enteredNumber(saved.official), verifiedOffer, { currency });
  const observedTotal = Number(observedCandidate?.totalAmount);
  const enteredTotal = enteredNumber(saved.googleTotal);
  const enteredTaxes = enteredNumber(saved.googleTaxes);
  const tolerance = currency === "JPY" ? 1 : 0.01;
  const googleTotalMatches = Number.isFinite(observedTotal) && Number.isFinite(enteredTotal) && Math.abs(observedTotal - enteredTotal) <= tolerance;
  const taxBreakdownValid = googleTotalMatches && Number.isFinite(enteredTaxes) && enteredTaxes >= 0 && enteredTaxes < enteredTotal;
  const taxCheckText = taxBreakdownValid
    ? `검산 완료: ${money(enteredTotal, currency)} - 세금·수수료 ${money(enteredTaxes, currency)} = 세전 ${money(enteredTotal - enteredTaxes, currency)}`
    : Number.isFinite(enteredTotal) && Number.isFinite(observedTotal) && !googleTotalMatches
      ? `입력한 전체 총액이 현재 Google 수집값 ${money(observedTotal, currency)}과 다릅니다. 최신 결제 화면 기준으로 다시 입력하세요.`
      : "Google은 세금 포함 총액만 제공합니다. 판매처 결제 직전 화면의 세금·수수료를 입력해야 세전 금액이 확정됩니다.";
  const now = Date.now();
  const quoteAge = now - Date.parse(saved.savedAt);
  const withOffset = value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value ?? "") ? Date.parse(value) : NaN;
  const bookingTime = withOffset(saved.bookedAt);
  const checkinTime = withOffset(saved.checkinAt);
  const windowKnown = Number.isFinite(bookingTime) && Number.isFinite(checkinTime);
  const windowOpen = windowKnown && bookingTime <= now && now <= bookingTime + 86400000 && now <= checkinTime - 86400000;
  const timeText = !windowKnown ? "신청 기한 미확인" : windowOpen ? "입력 시각 기준 신청 기한 내" : "신청 기한 밖 · 입력 시각 확인";
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
    ["내 예약 대비 가격 차이", googleAudit?.pass ? `${money(googleAudit.difference, currency)} 낮음 · 1% 초과` : Number.isFinite(googleAudit?.difference) ? `${money(Math.abs(googleAudit.difference), currency)} ${googleAudit.difference >= 0 ? "낮지만 1% 이하" : "높음"}` : Number.isFinite(manual.difference) ? `${money(manual.difference, currency)} · 조건 확인 전 판정 보류` : "비교 금액 확인 필요"],
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
    <details><summary>공식 화면 금액 입력·BRG 계산</summary>
    <form class="brg-form" data-id="${esc(stay.id)}">
      <label>Marriott 숙박 전체 세전 객실료 (${currency})<input name="official" type="number" min="0.01" step="0.01" required value="${esc(saved.official ?? "")}"></label>
      <label>Google 세금 포함 숙박 전체 총액 (${currency})<input name="googleTotal" type="number" min="0.01" step="0.01" value="${esc(saved.googleTotal ?? (Number.isFinite(observedTotal) ? observedTotal : ""))}"></label>
      <label>Google 판매처 결제단계 세금·수수료 (${currency})<input name="googleTaxes" type="number" min="0" step="0.01" value="${esc(saved.googleTaxes ?? "")}"></label>
      <p class="tax-check ${taxBreakdownValid ? "confirmed" : "pending"}">${esc(taxCheckText)}</p>
      <label>OTA 숙박 전체 세전 객실료 (${currency}, 직접 확인한 경우)<input name="offer" type="number" min="0.01" step="0.01" value="${esc(saved.offer ?? "")}"></label>
      <label>예약 완료 시각 (UTC 오프셋 포함)<input name="bookedAt" placeholder="2026-09-07T10:00:00+09:00" value="${esc(saved.bookedAt ?? "")}"></label>
      <label>호텔 표준 체크인 시각 (UTC 오프셋 포함)<input name="checkinAt" placeholder="2026-09-17T15:00:00+09:00" value="${esc(saved.checkinAt ?? "")}"></label>
      <button type="submit">이 브라우저에 저장하고 계산</button><output></output>
    </form>
    ${saved.savedAt ? `<p><b>${esc(manual.status)}</b> · ${timeText}<br>수동 입력 ${new Date(saved.savedAt).toLocaleString("ko-KR")} ${quoteAge > 86400000 ? "· 24시간 지난 입력: 재확인 필요" : "· 실시간 예약 가능 여부 재확인 필요"}</p>${manual.pass ? `<p>승인 시 OTA 세전 객실료 기준 예상: ${money(verifiedOffer * (stay.marriott.designHotels ? 0.8 : 0.75), currency)} (${stay.marriott.designHotels ? 20 : 25}% 할인) 또는 OTA 세전 객실료 ${money(verifiedOffer, currency)} + 5,000포인트. 세금·수수료 별도.</p>` : ""}` : ""}
    <p class="detail-note">동일 조건 최저 공개 요금을 입력하세요. 값은 이 브라우저에만 저장됩니다.</p></details>
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
  const latestFailedCount = collectorStatus?.results?.filter((result) => result.status !== "ok").length ?? 0;
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
    candidateOf(item.sourceResult) && dayKey(item.sourceRun.capturedAt) === dayKey(new Date())
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
    const candidate = candidateWithVerifiedPreTax(item.stay, candidateOf(item.sourceResult));
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
  const googlePreTaxVerifiedCount = displayed.filter((item) => candidateWithVerifiedPreTax(item.stay, candidateOf(item.sourceResult))?.preTaxVerified === true || candidateOf(item.sourceResult)?.amountBasis === "pre-tax").length;
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
    <div><b>${todayCandidateCount}/${stays.length}</b><span>Google 오늘 가격</span></div>
    <div><b>${todayMarriottCount}/${stays.length}</b><span>Marriott 오늘 가격</span></div>
    <div class="summary-pretax"><b>${googlePreTaxVerifiedCount}/${stays.length}</b><span>Google 세전 금액 확인</span></div>
    <div class="summary-google"><b>${googleLowerCount}곳</b><span>Google가 공식 현행가보다 낮음</span></div>
    <div class="summary-opportunity"><b>${googlePricePassCount}곳</b><span>내 예약 대비 가격차 충족</span></div>
    <div class="summary-drop"><b>${marriottDropCount}곳</b><span>Marriott 공식 객실료 인하</span></div>
    <div class="summary-fx"><b>${esc(fxText)}</b><span>원화는 참고 환산만</span></div>`;

  document.querySelector("#cards").innerHTML = displayed.map(({ stay, current, sourceResult, sourceRun, sourceIndex, stale }) => {
    const attempt = collectorStatus?.results?.find((item) => item.id === stay.id);
    const attemptWarning = attempt?.status && attempt.status !== "ok"
      ? `<p class="freshness">${esc(marriottStatusLabel(attempt.state))}${attempt.capturedAt ? ` · ${new Date(attempt.capturedAt).toLocaleString("ko-KR")}` : ""}</p>`
      : "";
    if (!sourceResult) {
      const googleLink = current?.searchUrl ?? `https://www.google.com/travel/search?q=${encodeURIComponent(stay.hotel)}`;
      const marriottLink = `https://www.marriott.com/en-us/hotels/${stay.marriott.propertyCode.toLowerCase()}-${stay.marriott.slug}/rooms/`;
      return `<article class="card error">
        <div class="card-head"><div><p>${stay.checkIn} → ${stay.checkOut}</p><h2>${esc(stay.displayName ?? stay.hotel)}</h2></div><span class="pill failed">수집 오류</span></div>
        ${attemptWarning}<p>${esc(current?.error ?? "표시할 가격 후보를 찾지 못했습니다.")}</p>
        ${chartMarkup([], stay)}
        ${brgMarkup(stay, current ?? {}, run, true)}
        <p class="room"><b>${esc(stay.booked.room)}</b><br>${esc(stay.booked.cancellation)} · ${esc(stay.booked.cancellationDeadline)}<br>예약 총액 ${money(stay.booked.total, stay.booked.currency)}</p>
        <div class="source-links"><a href="${esc(googleLink)}" target="_blank" rel="noreferrer">Google 후보 출처·조건 확인 →</a><a href="${esc(marriottLink)}" target="_blank" rel="noreferrer">Marriott 공식가·객실 확인 →</a></div>
      </article>`;
    }
    const today = candidateOf(sourceResult);
    const auditedToday = candidateWithVerifiedPreTax(stay, today);
    const todayRawAmount = localAmount(today, stay, sourceRun);
    const todayAmount = estimatedAllIn(todayRawAmount, stay);
    const previous = previousDayCandidate(runs, stay.id, sourceIndex, sourceRun.capturedAt);
    const previousAmount = previous ? estimatedAllIn(localAmount(candidateOf(previous.result), stay, previous.run), stay) : null;
    const delta = Number.isFinite(todayAmount) && Number.isFinite(previousAmount) ? todayAmount - previousAmount : null;
    const state = candidateState(sourceResult, stale);
    const bookedCurrency = stay.booked.currency;
    const rate = fxRate(sourceRun, bookedCurrency);
    const todayKrw = Number.isFinite(todayAmount) && rate ? Math.round(todayAmount * rate) : null;
    const bookedKrw = rate ? Math.round(stay.booked.total * rate) : null;
    const brgDifference = stay.booked.roomSubtotal - todayRawAmount;
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
    const googleEstimatedPreTax = googleIsTaxIncluded ? estimatedPreTax(todayAmount, stay) : null;
    const googlePreTaxLine = auditedToday?.preTaxVerified === true
      ? `<small class="google-pretax confirmed">확인 세전 <strong>${money(auditedToday.preTaxAmount, bookedCurrency)}</strong> · 세금·수수료 ${money(todayAmount - auditedToday.preTaxAmount, bookedCurrency)}</small>`
      : Number.isFinite(googleEstimatedPreTax)
        ? `<small class="google-pretax estimate">참고 추정 세전 ${money(googleEstimatedPreTax, bookedCurrency)} · ${esc(stay.allInEstimate?.note ?? "기존 예약 세율 기준")} · BRG 판정 미사용</small>`
        : `<small class="google-pretax pending">세전 금액 확인 필요 · BRG 판정 보류</small>`;
    return `<article class="card ${stale ? "stale" : ""} ${marriottPriceState === "lower" ? "has-rate-drop" : ""} ${googleAudit.lowerThanOfficial ? "has-google-opportunity" : ""}">
      <div class="card-head"><div><p>${stay.checkIn} → ${stay.checkOut}</p><h2>${esc(stay.displayName ?? stay.hotel)}</h2></div><span class="pill ${sourceResult.candidateKind === "exact" && !stale ? "match" : "review"}">${state}</span></div>
      ${currentWarning}${attemptWarning}${!marriottRate ? `<p class="freshness">공식가 확인 대기 · 아래에 공식 화면의 세전 객실료를 입력해 비교할 수 있습니다.</p>` : ""}
      ${marriottPriceState === "lower" ? `<div class="rate-drop-alert"><strong>↓ Marriott 공식 객실료 인하</strong><span>${esc(marriottDifferenceText)} · 동일 취소조건인지 확인 후 예약 변경 검토</span></div>` : ""}
      ${googleOpportunityMarkup(googleAudit, auditedToday, marriottRate, bookedCurrency)}
      <div class="prices three"><div class="booked-price"><span>내 예약 총액 <em>세금 포함</em></span><b>${money(stay.booked.total, bookedCurrency)}</b><small>${bookedKrw == null ? "원화 환산 불가" : `${won.format(bookedKrw)} 참고`}</small><small class="comparison-basis">BRG 비교 기준 객실료 <strong>${money(stay.booked.roomSubtotal, bookedCurrency)}</strong> · 세금 제외</small><small>세금·요금 ${money(stay.booked.taxesAndFees, bookedCurrency)}</small></div><div class="google-price"><span>${stale ? "최근 Google 세금 포함 전체 총액" : "오늘 Google 세금 포함 전체 총액"} <em>세금 포함</em></span><b>${money(todayAmount, bookedCurrency)}</b><small>${googleIsTaxIncluded ? "Stay total · taxes + fees 포함 확인" : "기존 기록 · 세금 기준 재확인 필요"}</small>${googlePreTaxLine}<small>${todayKrw == null ? "원화 환산 불가" : `${won.format(todayKrw)} 참고`} · ${delta == null ? "전일 유효 기록 없음" : `${delta > 0 ? "+" : ""}${money(delta, bookedCurrency)} vs ${dayKey(previous.run.capturedAt)}`}</small></div><div class="official-price ${marriottPriceState}"><span>${marriottStale ? "최근 Marriott 공식 객실료" : "오늘 Marriott 공식 객실료"} <em>세금 제외</em></span><b>${Number.isFinite(marriottAmount) ? money(marriottAmount, bookedCurrency) : "자동 조회 불가"}</b><strong class="marriott-delta ${marriottPriceState}">${esc(marriottDifferenceText)}</strong><small>${marriottRate?.rateName ? `${esc(marriottRate.rateName)} · ${esc(marriottRate.cancellation ?? "무료취소")}` : "선불·비환불 요금은 비교에서 제외"}</small><small>${marriottKrw == null ? "원화 환산 없음" : `${won.format(marriottKrw)} 참고`} · ${marriottRun ? new Date(marriottRun.capturedAt).toLocaleString("ko-KR") : ""}</small></div></div>
      ${chartMarkup(dailySeries(runs, stay), stay)}
      <p class="room"><b>${esc(stay.booked.room)}</b><br>${esc(stay.booked.cancellation)} · ${esc(stay.booked.cancellationDeadline)}${stay.booked.status ? `<br><strong class="booking-status">${esc(stay.booked.status)}</strong>` : ""}<br>객실료 ${money(stay.booked.roomSubtotal, bookedCurrency)} + 세금·요금 ${money(stay.booked.taxesAndFees, bookedCurrency)}<br>${esc(stay.booked.note)}</p>
      ${brgMarkup(stay, sourceResult, sourceRun, stale, googleAudit)}
      <div class="source-links"><a href="${esc(sourceResult.detailUrl ?? current?.searchUrl ?? "#")}" target="_blank" rel="noreferrer">Google 후보 출처·조건 확인 →</a><a href="${esc(marriottLink)}" target="_blank" rel="noreferrer">Marriott 공식가·객실 확인 →</a></div>
    </article>`;
  }).join("");
  document.querySelectorAll(".brg-form").forEach(form => form.addEventListener("submit", event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    try { localStorage.setItem(`brg:${form.dataset.id}`, JSON.stringify({ ...values, savedAt: new Date().toISOString() })); }
    catch { form.querySelector("output").textContent = "브라우저 저장에 실패했습니다."; return; }
    render();
  }));
}

render().catch((error) => {
  document.querySelector("#updated").textContent = "데이터 표시 오류";
  document.querySelector("#summary").innerHTML = "";
  document.querySelector("#cards").innerHTML = `<article class="card error"><h2>결과를 표시하지 못했습니다.</h2><p>${esc(error.message)}</p><button type="button" onclick="location.reload()">새로고침</button></article>`;
  console.error(error);
});

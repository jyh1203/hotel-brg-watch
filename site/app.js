import { assess, assessRate, threshold, policyUrl } from "./brg.js";
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
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const result = runs[index].results?.find((item) => item.id === stayId);
    if (marriottOf(result)) return { rate: result.marriott, run: runs[index], index };
  }
  return null;
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
  const booked = stay.booked.total;
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
    <div class="chart-head"><b>일별 수집 표시가 추이</b><span>${series.length}일 기록 · ${stay.booked.currency} 기준</span></div>
    <div class="chart-legend"><span class="booked-key">내 예약 총액</span><span class="google-key">Google 표시가 합계</span><span class="marriott-key">Marriott 표시가 합계</span></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(stay.hotel)} 일별 가격 비교 그래프">
      <line class="baseline" x1="${pad.left}" x2="${width - pad.right}" y1="${y(booked).toFixed(1)}" y2="${y(booked).toFixed(1)}"><title>예약가 ${money(booked, stay.booked.currency)}</title></line>
      ${line("googleAmount", "google")}${line("marriottAmount", "marriott")}
      <text x="${pad.left}" y="${height - 5}">${series[0].day.slice(5)}</text>
      <text x="${width - pad.right}" y="${height - 5}" text-anchor="end">${series.at(-1).day.slice(5)}</text>
    </svg>
    <div class="chart-caption"><span>예약 기준선 ${money(booked, stay.booked.currency)}</span><span>Google ${googleValues.length ? money(Math.min(...googleValues), stay.booked.currency) : "기록 없음"} · Marriott ${marriottValues.length ? money(Math.min(...marriottValues), stay.booked.currency) : "기록 없음"}</span></div>
  </div>`;
}

function candidateState(result, stale) {
  if (stale) return "최근 유효 결과";
  if (result.candidateKind === "exact") return "객실명 일치 · 조건 확인 필요";
  if (result.candidateKind === "free-cancel-review") return "무료취소·객실조건 확인";
  return "헤드라인가·수동 확인";
}

function rateText(rate) {
  return `${rate?.room ?? ""} ${rate?.context ?? ""} ${rate?.provider ?? ""}`.trim();
}

function roomCondition(rate, stay) {
  const text = rateText(rate);
  if (!text || !stay.match?.roomPatterns?.length || (!rate?.room && !rate?.context)) return null;
  return stay.match.roomPatterns.every((pattern) => new RegExp(pattern, "i").test(text));
}

function cancellationCondition(rate) {
  if (rate?.freeCancellation === true) return true;
  const text = rateText(rate);
  if (/non[- ]?refundable|환불\s*불가|취소\s*불가/i.test(text)) return false;
  return null;
}

function amountBasisLabel(rate) {
  if (rate?.amountBasis === "tax-exclusive" || rate?.taxesIncluded === false) return "세전 객실료";
  if (rate?.amountBasis === "tax-inclusive" || rate?.taxesIncluded === true) return "세금 포함 표시가";
  return "세금 포함 여부 미확인";
}

function claimDecisionMarkup(stay, verdict = null) {
  const claimWindow = stay.brg?.claimWindow ?? "unknown";
  if (claimWindow === "expired") return `<div class="claim-decision no"><span>현재 BRG 신청</span><b>불가</b><small>${esc(stay.brg?.note ?? "예약 후 24시간 접수기한 경과")}</small></div>`;
  if (!verdict) return `<div class="claim-decision review"><span>현재 BRG 신청</span><b>판정 보류</b><small>비교 요금과 신청기한 확인 필요</small></div>`;
  return `<div class="claim-decision ${verdict.tone}"><span>현재 BRG 신청</span><b>${esc(verdict.label)}</b><small>${esc(verdict.reasons.join(" · ") || "가격·객실·취소조건 확인 완료")}</small></div>`;
}

function bookedBreakdownMarkup(stay, bookedKrw) {
  const { booked } = stay;
  const currency = booked.currency;
  return `<div class="price-box booked-price">
    <div class="price-box-head"><span>내 예약</span><em>총액·구성 확인</em></div>
    <strong class="price-total">${money(booked.total, currency)}</strong>
    <dl class="price-parts">
      <div><dt>숙박 객실료</dt><dd>${money(booked.roomSubtotal, currency)}</dd></div>
      <div><dt>세금</dt><dd>${money(booked.taxes, currency)}</dd></div>
      <div><dt>수수료·현지요금</dt><dd>${money(booked.fees, currency)}</dd></div>
      <div class="total-line"><dt>결제 총액</dt><dd>${money(booked.total, currency)}</dd></div>
    </dl>
    <small>${bookedKrw == null ? "원화 환산 불가" : `${won.format(bookedKrw)} 참고 환산`}</small>
  </div>`;
}

function observedBreakdownMarkup({ label, amount, rate, currency, krw, stale, meta = "" }) {
  const hasAmount = Number.isFinite(amount);
  return `<div class="price-box observed-price">
    <div class="price-box-head"><span>${esc(label)}</span><em class="basis-unknown">${esc(hasAmount ? amountBasisLabel(rate) : "가격 미확인")}</em></div>
    <strong class="price-total">${hasAmount ? money(amount, currency) : "자동 조회 불가"}</strong>
    <dl class="price-parts unknown-parts">
      <div><dt>표시가 합계</dt><dd>${hasAmount ? money(amount, currency) : "—"}</dd></div>
      <div><dt>세금</dt><dd>미확인</dd></div>
      <div><dt>수수료·현지요금</dt><dd>미확인</dd></div>
      <div class="total-line"><dt>최종 결제액</dt><dd>미확인</dd></div>
    </dl>
    <small>${krw == null ? "원화 환산 없음" : `${won.format(krw)} 참고 환산`}${stale ? " · 과거 기록" : ""}${meta ? ` · ${esc(meta)}` : ""}</small>
  </div>`;
}


function savedQuote(id) {
  try { return JSON.parse(localStorage.getItem(`brg:${id}`)) ?? {}; } catch { return {}; }
}
function brgMarkup(stay, result, sourceRun, stale) {
  const saved = savedQuote(stay.id);
  const base = stay.booked.roomSubtotal;
  const currency = stay.booked.currency;
  const limit = threshold(base, false, currency);
  const converted = threshold(base, true, currency);
  const rates = result.roomRates?.length ? result.roomRates : result.providers ?? [];
  const selected = candidateOf(result);
  const selectedAmount = localAmount(selected, stay, sourceRun);
  const selectedVerdict = selected ? assessRate({
    officialSubtotal: base,
    offer: selectedAmount,
    currency,
    offerCurrency: selected.currency ?? currency,
    amountBasis: selected.amountBasis ?? "unknown",
    roomMatch: roomCondition(selected, stay),
    cancellationMatch: cancellationCondition(selected),
    stale,
    claimWindow: stay.brg?.claimWindow ?? "unknown"
  }) : null;
  const rows = rates.map((rate) => {
    const rateCurrency = rate.currency ?? currency;
    const displayedAmount = localAmount(rate, stay, sourceRun);
    const verdict = assessRate({
      officialSubtotal: base,
      offer: displayedAmount,
      currency,
      offerCurrency: rateCurrency,
      amountBasis: rate.amountBasis ?? "unknown",
      roomMatch: roomCondition(rate, stay),
      cancellationMatch: cancellationCondition(rate),
      stale,
      claimWindow: stay.brg?.claimWindow ?? "unknown"
    });
    const label = rate.provider ?? rate.room ?? rate.context?.split(" · ").slice(0, 2).join(" · ") ?? "수집 요금";
    const roomAmount = rate.amountBasis === "tax-exclusive" || rate.taxesIncluded === false ? displayedAmount : null;
    const payableAmount = rate.amountBasis === "tax-inclusive" || rate.taxesIncluded === true ? displayedAmount : null;
    const conditions = [
      roomCondition(rate, stay) === true ? "객실 일치" : roomCondition(rate, stay) === false ? "객실 불일치" : "객실 미확인",
      cancellationCondition(rate) === true ? "무료취소 확인" : cancellationCondition(rate) === false ? "취소조건 불일치" : "취소조건 미확인"
    ].join(" · ");
    return `<tr>
      <td><b>${esc(label)}</b><small>${esc(amountBasisLabel(rate))}</small></td>
      <td>${Number.isFinite(displayedAmount) ? money(displayedAmount, rateCurrency) : "—"}</td>
      <td>${Number.isFinite(roomAmount) ? money(roomAmount, rateCurrency) : "미확인"}</td>
      <td>미확인</td><td>미확인</td>
      <td>${Number.isFinite(payableAmount) ? money(payableAmount, rateCurrency) : "미확인"}</td>
      <td><small>${esc(conditions)}</small></td>
      <td><span class="verdict ${verdict.tone}">${esc(verdict.label)}</span><small>${esc(verdict.priceLabel)}${verdict.reasons.length ? ` · ${verdict.reasons.join(" · ")}` : ""}</small></td>
    </tr>`;
  }).join("");
  const manual = assess(Number(saved.official), Number(saved.offer), { currency, exchanged: saved.exchange === "yes" });
  const now = Date.now();
  const quoteAge = now - Date.parse(saved.savedAt);
  const withOffset = value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value ?? "") ? Date.parse(value) : NaN;
  const bookingTime = withOffset(saved.bookedAt);
  const checkinTime = withOffset(saved.checkinAt);
  const windowKnown = Number.isFinite(bookingTime) && Number.isFinite(checkinTime);
  const windowOpen = windowKnown && bookingTime <= now && now <= bookingTime + 86400000 && now <= checkinTime - 86400000;
  const timeText = !windowKnown ? "신청 기한 미확인" : windowOpen ? "입력 시각 기준 신청 기한 내" : "신청 기한 밖 · 입력 시각 확인";
  return `<section class="brg-panel"><h3>BRG 신청 판정</h3>
    ${claimDecisionMarkup(stay, selectedVerdict)}
    <div class="brg-threshold"><span>동일 통화 OTA 세전 상한 <b>${money(limit.max, currency)}</b></span><span>환전 요금 세전 상한 <b>${money(converted.max, currency)}</b></span></div>
    <p>기준 Marriott 객실료는 세금·수수료 제외 ${money(base, currency)}입니다. 외부 표시가가 상한 이하여도 숙박 전체 세전 객실료, 동일 객실·침대·인원·혜택·취소조건, 공개 예약 가능 상태가 모두 확인돼야 신청 후보가 됩니다.</p>
    <details open><summary>수집한 각 요금별 구성·판정 (${rates.length}개)</summary><div class="rate-scroll"><table class="rate-table"><thead><tr><th>객실·판매처</th><th>수집 표시가</th><th>숙박비(세전)</th><th>세금</th><th>수수료</th><th>최종 결제액</th><th>조건</th><th>BRG 판정</th></tr></thead><tbody>${rows || '<tr><td colspan="8">비교 가능한 외부 요금이 없습니다.</td></tr>'}</tbody></table></div><p>수집 시각 ${new Date(sourceRun.capturedAt).toLocaleString("ko-KR")} · <code>미확인</code> 금액은 자동으로 0원 처리하지 않으며 BRG 가능 판정을 보류합니다.</p></details>
    <details><summary>공식 화면 금액 입력·BRG 계산</summary>
    <form class="brg-form" data-id="${esc(stay.id)}">
      <label>Marriott 숙박 전체 세전 객실료 (${currency})<input name="official" type="number" min="0.01" step="0.01" required value="${esc(saved.official ?? "")}"></label>
      <label>OTA 숙박 전체 세전 객실료 (${currency}, 환전 시 환산액)<input name="offer" type="number" min="0.01" step="0.01" required value="${esc(saved.offer ?? "")}"></label>
      <label>OTA 원래 통화<select name="exchange"><option value="no">동일 통화</option><option value="yes" ${saved.exchange === "yes" ? "selected" : ""}>다른 통화에서 환산</option></select></label>
      <label>예약 완료 시각 (UTC 오프셋 포함)<input name="bookedAt" placeholder="2026-09-07T10:00:00+09:00" value="${esc(saved.bookedAt ?? "")}"></label>
      <label>호텔 표준 체크인 시각 (UTC 오프셋 포함)<input name="checkinAt" placeholder="2026-09-17T15:00:00+09:00" value="${esc(saved.checkinAt ?? "")}"></label>
      <button type="submit">이 브라우저에 저장하고 계산</button><output></output>
    </form>
    ${saved.savedAt ? `<p><b>${esc(manual.status)}</b> · ${timeText}<br>수동 입력 ${new Date(saved.savedAt).toLocaleString("ko-KR")} ${quoteAge > 86400000 ? "· 24시간 지난 입력: 재확인 필요" : "· 실시간 예약 가능 여부 재확인 필요"}</p>${manual.pass ? `<p>승인 시 OTA 세전 객실료 기준 예상: ${money(Number(saved.offer) * (stay.marriott.designHotels ? 0.8 : 0.75), currency)} (${stay.marriott.designHotels ? 20 : 25}% 할인) 또는 OTA 세전 객실료 ${money(Number(saved.offer), currency)} + 5,000포인트. 세금·수수료 별도.</p>` : ""}` : ""}
    <p>공식 예약의 동일 조건 최저 공개 요금(회원가 포함)을 입력하세요. 수동 입력은 메리어트 자동 수집값과 별도로 이 브라우저에만 보관됩니다.</p></details>
    <p>신청 전 확인: 동일 호텔·숙박 전체 날짜·객실·침대·인원(최대 2명)·조식 등 포함 혜택·취소/환불 조건. 누구나 예약 가능한 요금이며 쿠폰·캐시백·특수 자격 요금은 제외. Bonvoy 회원 예약 후 24시간 이내이면서 표준 체크인 최소 24시간 전 신청. 최종 승인 여부는 Marriott의 실시간 검증으로 결정됩니다. <a href="${policyUrl}" target="_blank" rel="noreferrer">공식 규칙</a></p>
  </section>`;
}

async function render() {
  const response = await fetch(`data.json?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`데이터 요청 실패 (HTTP ${response.status})`);
  const data = await response.json();
  const runs = Array.isArray(data.runs) ? data.runs : [];
  const run = runs[runs.length - 1];
  const stays = data.config?.stays ?? [];

  document.querySelector("#updated").textContent = run
    ? `마지막 확인 ${new Date(run.capturedAt).toLocaleString("ko-KR")}`
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
    return Boolean(marriottOf(result)) && dayKey(run.capturedAt) === dayKey(new Date());
  }).length;
  const shownCount = displayed.filter((item) => candidateOf(item.sourceResult)).length;
  const cheaperCount = displayed.filter((item) => {
    const amount = localAmount(candidateOf(item.sourceResult), item.stay, item.sourceRun);
    return item.sourceResult?.candidateKind !== "headline-review" && Number.isFinite(amount) && amount < item.stay.booked.roomSubtotal;
  }).length;
  const rates = run.fx?.rates ?? (run.fx?.rate ? { EUR: run.fx.rate } : {});
  const fxText = Object.entries(rates)
    .map(([currency, rate]) => `1 ${currency}=${Number(rate).toFixed(currency === "JPY" ? 2 : 1)}원`)
    .join(" · ") || "환율 없음";
  document.querySelector("#summary").innerHTML = `
    <div><b>${shownCount}/${stays.length}</b><span>결과 표시</span></div>
    <div><b>${todayCandidateCount}/${stays.length}</b><span>Google 오늘 가격</span></div>
    <div><b>${todayMarriottCount}/${stays.length}</b><span>Marriott 오늘 가격</span></div>
    <div><b>${cheaperCount}곳</b><span>표시가 참고 차이 (조건 미확인)</span></div>
    <div><b>${esc(fxText)}</b><span>원화는 참고 환산만</span></div>`;

  document.querySelector("#cards").innerHTML = displayed.map(({ stay, current, sourceResult, sourceRun, sourceIndex, stale }) => {
    if (!sourceResult) {
      const googleLink = current?.searchUrl ?? `https://www.google.com/travel/search?q=${encodeURIComponent(stay.hotel)}`;
      const marriottLink = `https://www.marriott.com/en-us/hotels/${stay.marriott.propertyCode.toLowerCase()}-${stay.marriott.slug}/rooms/`;
      return `<article class="card error">
        <div class="card-head"><div><p>${stay.checkIn} → ${stay.checkOut}</p><h2>${esc(stay.displayName ?? stay.hotel)}</h2></div><span class="pill failed">수집 오류</span></div>
        <p>${esc(current?.error ?? "표시할 가격 후보를 찾지 못했습니다.")}</p>
        ${chartMarkup([], stay)}
        ${brgMarkup(stay, current ?? {}, run, true)}
        <p class="room"><b>${esc(stay.booked.room)}</b><br>${esc(stay.booked.cancellation)} · ${esc(stay.booked.cancellationDeadline)}<br>예약 총액 ${money(stay.booked.total, stay.booked.currency)}</p>
        <div class="source-links"><a href="${esc(googleLink)}" target="_blank" rel="noreferrer">Google 후보 출처·조건 확인 →</a><a href="${esc(marriottLink)}" target="_blank" rel="noreferrer">Marriott 공식가·객실 확인 →</a></div>
      </article>`;
    }
    const today = candidateOf(sourceResult);
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
    const marriottLink = marriottRate?.sourceUrl ?? current?.marriott?.sourceUrl ??
      `https://www.marriott.com/en-us/hotels/${stay.marriott.propertyCode.toLowerCase()}-${stay.marriott.slug}/rooms/`;
    const currentWarning = stale
      ? `<p class="freshness">최신 수집값이 비어 있어 ${new Date(sourceRun.capturedAt).toLocaleString("ko-KR")}의 최근 유효 결과를 표시합니다.</p>`
      : "";
    return `<article class="card ${stale ? "stale" : ""}">
      <div class="card-head"><div><p>${stay.checkIn} → ${stay.checkOut}</p><h2>${esc(stay.displayName ?? stay.hotel)}</h2></div><span class="pill ${sourceResult.candidateKind === "exact" && !stale ? "match" : "review"}">${state}</span></div>
      ${currentWarning}${!currentMarriott ? `<p class="freshness">${esc(current?.marriott?.error ?? "공식가 미확인")} ${current?.marriott?.reference ? `Google의 Marriott 참고 표시가 ${money(current.marriott.reference.totalAmount, bookedCurrency)} · 조건 미확인` : "아래에 공식 화면의 세전 객실료를 입력해 비교할 수 있습니다."}</p>` : ""}
      <div class="prices three">
        ${bookedBreakdownMarkup(stay, bookedKrw)}
        ${observedBreakdownMarkup({
          label: stale ? "최근 Google 요금" : "오늘 Google 요금",
          amount: todayAmount,
          rate: today,
          currency: bookedCurrency,
          krw: todayKrw,
          stale,
          meta: delta == null ? "전일 기록 없음" : `${delta > 0 ? "+" : ""}${money(delta, bookedCurrency)} vs ${dayKey(previous.run.capturedAt)}`
        })}
        ${observedBreakdownMarkup({
          label: marriottStale ? "최근 Marriott 공식 요금" : "오늘 Marriott 공식 요금",
          amount: marriottAmount,
          rate: marriottRate,
          currency: bookedCurrency,
          krw: marriottKrw,
          stale: marriottStale,
          meta: marriottRate?.rateName ?? current?.marriott?.error ?? "공식가 기록 없음"
        })}
      </div>
      ${chartMarkup(dailySeries(runs, stay), stay)}
      <p class="room"><b>${esc(stay.booked.room)}</b><br>${esc(stay.booked.cancellation)} · ${esc(stay.booked.cancellationDeadline)}${stay.booked.status ? `<br><strong class="booking-status">${esc(stay.booked.status)}</strong>` : ""}<br>객실료 ${money(stay.booked.roomSubtotal, bookedCurrency)} + 세금·요금 ${money(stay.booked.taxesAndFees, bookedCurrency)}<br>${esc(stay.booked.note)}</p>
      ${brgMarkup(stay, sourceResult, sourceRun, stale)}
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

const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const money = (amount, currency) => new Intl.NumberFormat("ko-KR", {
  style: "currency", currency, maximumFractionDigits: currency === "JPY" ? 0 : 2
}).format(amount);
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]
));
const candidateOf = (result) => result && (result.exactCandidate ?? result.freeCancellation ?? result.lowestProvider);
const dayKey = (value) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date(value));

function latestCandidate(runs, stayId, beforeIndex = runs.length) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const result = runs[index].results?.find((item) => item.id === stayId);
    if (result?.status === "ok" && candidateOf(result)) return { result, run: runs[index], index };
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

function candidateState(result, stale) {
  if (stale) return "최근 유효 결과";
  if (result.candidateKind === "exact") return "동일 조건 자동 후보";
  if (result.candidateKind === "free-cancel-review") return "무료취소·객실조건 확인";
  return "헤드라인가·수동 확인";
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
      stale: !currentCandidate && Boolean(fallback)
    };
  });
  const todayCandidateCount = displayed.filter((item) => (
    candidateOf(item.sourceResult) && dayKey(item.sourceRun.capturedAt) === dayKey(run.capturedAt)
  )).length;
  const shownCount = displayed.filter((item) => candidateOf(item.sourceResult)).length;
  const savings = displayed.reduce((sum, item) => sum + Math.max(0, item.sourceResult?.candidateSavingsKrw ?? 0), 0);
  const rates = run.fx?.rates ?? (run.fx?.rate ? { EUR: run.fx.rate } : {});
  const fxText = Object.entries(rates)
    .map(([currency, rate]) => `${currency} ${Number(rate).toFixed(currency === "JPY" ? 2 : 1)}`)
    .join(" · ") || "환율 없음";
  document.querySelector("#summary").innerHTML = `
    <div><b>${shownCount}/${stays.length}</b><span>결과 표시</span></div>
    <div><b>${todayCandidateCount}/${stays.length}</b><span>오늘 가격 확보</span></div>
    <div><b>${won.format(savings)}</b><span>잠재 절감액</span></div>
    <div><b>${esc(fxText)}</b><span>원화 환산 기준</span></div>`;

  document.querySelector("#cards").innerHTML = displayed.map(({ stay, current, sourceResult, sourceRun, sourceIndex, stale }) => {
    if (!sourceResult) {
      return `<article class="card error">
        <div class="card-head"><div><p>${stay.checkIn} → ${stay.checkOut}</p><h2>${esc(stay.hotel)}</h2></div><span class="pill failed">수집 오류</span></div>
        <p>${esc(current?.error ?? "표시할 가격 후보를 찾지 못했습니다.")}</p>
      </article>`;
    }
    const today = candidateOf(sourceResult);
    const previous = previousDayCandidate(runs, stay.id, sourceIndex, sourceRun.capturedAt);
    const yesterday = candidateOf(previous?.result);
    const delta = today && yesterday ? today.totalKrw - yesterday.totalKrw : null;
    const state = candidateState(sourceResult, stale);
    const bookedAmount = sourceResult.bookedAmount ?? stay.booked.total;
    const bookedCurrency = sourceResult.bookedCurrency ?? stay.booked.currency;
    const rate = sourceRun.fx?.rates?.[bookedCurrency] ?? sourceRun.fx?.rate;
    const bookedKrw = sourceResult.bookedKrw ?? (rate ? Math.round(bookedAmount * rate) : null);
    const currentWarning = stale
      ? `<p class="freshness">오늘 수집값이 비어 있어 ${new Date(sourceRun.capturedAt).toLocaleString("ko-KR")}의 최근 유효 결과를 표시합니다.</p>`
      : "";
    return `<article class="card ${stale ? "stale" : ""}">
      <div class="card-head"><div><p>${stay.checkIn} → ${stay.checkOut}</p><h2>${esc(stay.hotel)}</h2></div><span class="pill ${sourceResult.candidateKind === "exact" && !stale ? "match" : "review"}">${state}</span></div>
      ${currentWarning}
      <div class="prices"><div><span>내 예약 총액</span><b>${money(bookedAmount, bookedCurrency)}</b><small>${bookedKrw == null ? "환산 불가" : won.format(bookedKrw)}</small></div><div><span>${stale ? "최근 후보가" : "오늘 후보가"}</span><b>${won.format(today.totalKrw)}</b><small>${delta == null ? "전일 유효 기록 없음" : `${delta > 0 ? "+" : ""}${won.format(delta)} vs ${dayKey(previous.run.capturedAt)}`}</small></div></div>
      <p class="room"><b>${esc(stay.booked.room)}</b><br>${esc(stay.booked.cancellation)} · ${esc(stay.booked.cancellationDeadline)}<br>객실료 ${money(stay.booked.roomSubtotal, stay.booked.currency)} + 세금·요금 ${money(stay.booked.taxesAndFees, stay.booked.currency)}<br>${esc(stay.booked.note)}</p>
      <p class="saving ${(sourceResult.candidateSavingsKrw ?? 0) > 0 ? "positive" : ""}">${sourceResult.candidateSavingsKrw == null ? "헤드라인 참고가 — 동일 조건 수동 확인 필요" : `예약가 대비 ${won.format(Math.abs(sourceResult.candidateSavingsKrw))} ${(sourceResult.candidateSavingsKrw > 0) ? "저렴" : "높음"}`}</p>
      <a href="${esc(sourceResult.detailUrl ?? current?.searchUrl ?? "#")}" target="_blank" rel="noreferrer">Google Hotels에서 조건 확인 →</a>
    </article>`;
  }).join("");
}

render().catch((error) => {
  document.querySelector("#updated").textContent = "데이터 표시 오류";
  document.querySelector("#summary").innerHTML = "";
  document.querySelector("#cards").innerHTML = `<article class="card error"><h2>결과를 표시하지 못했습니다.</h2><p>${esc(error.message)}</p><button type="button" onclick="location.reload()">새로고침</button></article>`;
  console.error(error);
});

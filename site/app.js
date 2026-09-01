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

function fxRate(run, currency) {
  return run?.fx?.rates?.[currency] ?? (currency === "EUR" ? run?.fx?.rate : null);
}

function localAmount(candidate, stay, run) {
  if (Number.isFinite(candidate?.totalAmount)) return candidate.totalAmount;
  const rate = fxRate(run, stay.booked.currency);
  return Number.isFinite(candidate?.totalKrw) && rate ? candidate.totalKrw / rate : null;
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
    const amount = localAmount(candidate, stay, run);
    if (result?.status === "ok" && Number.isFinite(amount)) {
      byDay.set(dayKey(run.capturedAt), { day: dayKey(run.capturedAt), amount, result });
    }
  });
  return [...byDay.values()].slice(-60);
}

function chartMarkup(series, stay) {
  if (!series.length) return '<div class="chart empty-chart">그래프를 만들 가격 기록이 없습니다.</div>';
  const width = 340;
  const height = 130;
  const pad = { left: 12, right: 12, top: 16, bottom: 24 };
  const booked = stay.booked.total;
  const values = [...series.map((point) => point.amount), booked];
  let min = Math.min(...values);
  let max = Math.max(...values);
  const gap = max - min || Math.max(1, max * 0.05);
  min -= gap * 0.15;
  max += gap * 0.15;
  const x = (index) => series.length === 1
    ? width / 2
    : pad.left + index * ((width - pad.left - pad.right) / (series.length - 1));
  const y = (value) => pad.top + ((max - value) / (max - min)) * (height - pad.top - pad.bottom);
  const points = series.map((point, index) => `${x(index).toFixed(1)},${y(point.amount).toFixed(1)}`).join(" ");
  const circles = series.map((point, index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(point.amount).toFixed(1)}" r="4"><title>${point.day} ${money(point.amount, stay.booked.currency)}</title></circle>`).join("");
  return `<div class="chart">
    <div class="chart-head"><b>일별 후보가</b><span>${series.length}일 기록 · ${stay.booked.currency} 기준</span></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(stay.hotel)} 일별 후보가 그래프">
      <line class="baseline" x1="${pad.left}" x2="${width - pad.right}" y1="${y(booked).toFixed(1)}" y2="${y(booked).toFixed(1)}"><title>예약가 ${money(booked, stay.booked.currency)}</title></line>
      <polyline points="${points}"></polyline>${circles}
      <text x="${pad.left}" y="${height - 5}">${series[0].day.slice(5)}</text>
      <text x="${width - pad.right}" y="${height - 5}" text-anchor="end">${series.at(-1).day.slice(5)}</text>
    </svg>
    <div class="chart-caption"><span>예약 기준선 ${money(booked, stay.booked.currency)}</span><span>최저 ${money(Math.min(...series.map((point) => point.amount)), stay.booked.currency)}</span></div>
  </div>`;
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
  const cheaperCount = displayed.filter((item) => {
    const amount = localAmount(candidateOf(item.sourceResult), item.stay, item.sourceRun);
    return item.sourceResult?.candidateKind !== "headline-review" && Number.isFinite(amount) && amount < item.stay.booked.total;
  }).length;
  const rates = run.fx?.rates ?? (run.fx?.rate ? { EUR: run.fx.rate } : {});
  const fxText = Object.entries(rates)
    .map(([currency, rate]) => `1 ${currency}=${Number(rate).toFixed(currency === "JPY" ? 2 : 1)}원`)
    .join(" · ") || "환율 없음";
  document.querySelector("#summary").innerHTML = `
    <div><b>${shownCount}/${stays.length}</b><span>결과 표시</span></div>
    <div><b>${todayCandidateCount}/${stays.length}</b><span>오늘 가격 확보</span></div>
    <div><b>${cheaperCount}곳</b><span>동일조건 가격 우위</span></div>
    <div><b>${esc(fxText)}</b><span>원화는 참고 환산만</span></div>`;

  document.querySelector("#cards").innerHTML = displayed.map(({ stay, current, sourceResult, sourceRun, sourceIndex, stale }) => {
    if (!sourceResult) {
      return `<article class="card error">
        <div class="card-head"><div><p>${stay.checkIn} → ${stay.checkOut}</p><h2>${esc(stay.hotel)}</h2></div><span class="pill failed">수집 오류</span></div>
        <p>${esc(current?.error ?? "표시할 가격 후보를 찾지 못했습니다.")}</p>
      </article>`;
    }
    const today = candidateOf(sourceResult);
    const todayAmount = localAmount(today, stay, sourceRun);
    const todayKrw = krwAmount(today, stay, sourceRun);
    const previous = previousDayCandidate(runs, stay.id, sourceIndex, sourceRun.capturedAt);
    const previousAmount = previous ? localAmount(candidateOf(previous.result), stay, previous.run) : null;
    const delta = Number.isFinite(todayAmount) && Number.isFinite(previousAmount) ? todayAmount - previousAmount : null;
    const state = candidateState(sourceResult, stale);
    const bookedCurrency = stay.booked.currency;
    const rate = fxRate(sourceRun, bookedCurrency);
    const bookedKrw = rate ? Math.round(stay.booked.total * rate) : null;
    const difference = stay.booked.total - todayAmount;
    const currentWarning = stale
      ? `<p class="freshness">최신 수집값이 비어 있어 ${new Date(sourceRun.capturedAt).toLocaleString("ko-KR")}의 최근 유효 결과를 표시합니다.</p>`
      : "";
    const comparison = sourceResult.candidateKind === "headline-review"
      ? `헤드라인 기준 예약가 대비 ${money(Math.abs(difference), bookedCurrency)} ${difference > 0 ? "저렴" : "높음"} · 동일 조건 수동 확인 필요`
      : `예약가 대비 ${money(Math.abs(difference), bookedCurrency)} ${difference > 0 ? "저렴" : "높음"}`;
    return `<article class="card ${stale ? "stale" : ""}">
      <div class="card-head"><div><p>${stay.checkIn} → ${stay.checkOut}</p><h2>${esc(stay.hotel)}</h2></div><span class="pill ${sourceResult.candidateKind === "exact" && !stale ? "match" : "review"}">${state}</span></div>
      ${currentWarning}
      <div class="prices"><div><span>내 예약 총액</span><b>${money(stay.booked.total, bookedCurrency)}</b><small>${bookedKrw == null ? "원화 환산 불가" : `${won.format(bookedKrw)} 참고`}</small></div><div><span>${stale ? "최근 후보가" : "오늘 후보가"}</span><b>${money(todayAmount, bookedCurrency)}</b><small>${todayKrw == null ? "원화 환산 불가" : `${won.format(todayKrw)} 참고`}</small><small>${delta == null ? "전일 유효 기록 없음" : `${delta > 0 ? "+" : ""}${money(delta, bookedCurrency)} vs ${dayKey(previous.run.capturedAt)}`}</small></div></div>
      ${chartMarkup(dailySeries(runs, stay), stay)}
      <p class="room"><b>${esc(stay.booked.room)}</b><br>${esc(stay.booked.cancellation)} · ${esc(stay.booked.cancellationDeadline)}<br>객실료 ${money(stay.booked.roomSubtotal, bookedCurrency)} + 세금·요금 ${money(stay.booked.taxesAndFees, bookedCurrency)}<br>${esc(stay.booked.note)}</p>
      <p class="saving ${difference > 0 && sourceResult.candidateKind !== "headline-review" ? "positive" : ""}">${comparison}</p>
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

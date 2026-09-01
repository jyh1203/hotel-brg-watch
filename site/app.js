const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const money = (amount, currency) => new Intl.NumberFormat("ko-KR", {
  style: "currency", currency, maximumFractionDigits: currency === "JPY" ? 0 : 2
}).format(amount);
const esc = (v) => String(v ?? "").replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const data = await fetch("data.json", { cache: "no-store" }).then((r) => r.json());
const run = data.runs.at(-1);
const dayKey = (value) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date(value));
const currentDay = run ? dayKey(run.capturedAt) : null;
const previous = run ? data.runs.slice(0, -1).reverse().find((item) => dayKey(item.capturedAt) !== currentDay) : null;
const stays = new Map(data.config.stays.map((stay) => [stay.id, stay]));

document.querySelector("#updated").textContent = run ? `마지막 확인 ${new Date(run.capturedAt).toLocaleString("ko-KR")}` : "아직 수집 기록 없음";
if (!run) {
  document.querySelector("#cards").innerHTML = '<article class="empty">npm run collect를 실행하면 첫 가격이 표시됩니다.</article>';
} else {
  const ok = run.results.filter((r) => r.status === "ok");
  const savings = ok.reduce((sum, r) => sum + Math.max(0, r.candidateSavingsKrw ?? 0), 0);
  const rates = run.fx.rates ?? { EUR: run.fx.rate };
  const fxText = Object.entries(rates).map(([currency, rate]) => `${currency} ${Number(rate).toFixed(currency === "JPY" ? 2 : 1)}`).join(" · ");
  document.querySelector("#summary").innerHTML = `<div><b>${ok.length}/${run.results.length}</b><span>정상 수집</span></div><div><b>${won.format(savings)}</b><span>잠재 절감액</span></div><div><b>${esc(fxText)}</b><span>원화 환산 기준</span></div>`;
  document.querySelector("#cards").innerHTML = run.results.map((result) => {
    const stay = stays.get(result.id);
    if (result.status !== "ok") return `<article class="card error"><h2>${esc(result.hotel)}</h2><p>${esc(result.error)}</p></article>`;
    const old = previous?.results.find((r) => r.id === result.id && r.status === "ok");
    const today = result.exactCandidate ?? result.freeCancellation ?? result.lowestProvider;
    const yesterday = old && (old.exactCandidate ?? old.freeCancellation ?? old.lowestProvider);
    const delta = today && yesterday ? today.totalKrw - yesterday.totalKrw : null;
    const state = result.candidateKind === "exact" ? "동일 조건 자동 후보" : result.candidateKind === "free-cancel-review" ? "무료취소·객실조건 확인" : "헤드라인가·수동 확인";
    return `<article class="card">
      <div class="card-head"><div><p>${stay.checkIn} → ${stay.checkOut}</p><h2>${esc(result.hotel)}</h2></div><span class="pill ${result.candidateKind === "exact" ? "match" : "review"}">${state}</span></div>
      <div class="prices"><div><span>내 예약 총액</span><b>${money(result.bookedAmount ?? result.bookedEur, result.bookedCurrency ?? "EUR")}</b><small>${won.format(result.bookedKrw)}</small></div><div><span>오늘 후보가</span><b>${today ? won.format(today.totalKrw) : "확인 실패"}</b><small>${delta == null ? "전일 기록 없음" : `${delta > 0 ? "+" : ""}${won.format(delta)} vs ${dayKey(previous.capturedAt)}`}</small></div></div>
      <p class="room"><b>${esc(stay.booked.room)}</b><br>${esc(stay.booked.cancellation)} · ${esc(stay.booked.cancellationDeadline)}<br>객실료 ${money(stay.booked.roomSubtotal, stay.booked.currency)} + 세금·요금 ${money(stay.booked.taxesAndFees, stay.booked.currency)}<br>${esc(stay.booked.note)}</p>
      <p class="saving ${(result.candidateSavingsKrw ?? 0) > 0 ? "positive" : ""}">${result.candidateSavingsKrw == null ? "비교 후보 없음" : `예약가 대비 ${won.format(Math.abs(result.candidateSavingsKrw))} ${(result.candidateSavingsKrw > 0) ? "저렴" : "높음"}`}</p>
      <a href="${esc(result.detailUrl)}" target="_blank" rel="noreferrer">Google Hotels에서 조건 확인 →</a>
    </article>`;
  }).join("");
}

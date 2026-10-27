// User-entered reference amounts, deliberately isolated from collected/verified BRG rates.
export function parsePriceInput(value, currency = 'EUR') {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const decimals = ['JPY', 'KRW'].includes(currency) ? 0 : 2;
  const pattern = decimals ? /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/ : /^(?:\d+|\d{1,3}(?:,\d{3})+)$/;
  if (!pattern.test(text)) return NaN;
  const amount = Number(text.replaceAll(',', ''));
  return Number.isSafeInteger(Math.round(amount * (decimals ? 100 : 1))) ? amount : NaN;
}
export function quickPriceComparison({stay, total, currency, includedFees = null}) {
  const pending = {eligible: false, verified: false};
  if (!Number.isFinite(total) || total <= 0) return {...pending, error: 'Google 숙박 전체 총액을 올바르게 입력하세요.'};
  if (currency !== stay.booked.currency) return {...pending, error: `예약 통화 ${stay.booked.currency}와 같은 통화로 확인하세요. 환산 비교는 하지 않습니다.`};
  if (includedFees !== null && (!Number.isFinite(includedFees) || includedFees < 0 || includedFees >= total))
    return {...pending, error: '총액에 이미 포함된 세금·수수료는 0 이상, 총액 미만이어야 합니다. 모르면 비워 두세요.'};
  const scale = ['JPY', 'KRW'].includes(currency) ? 1 : 100;
  const round = n => Math.round(n * scale) / scale;
  const bookedTotal = Number.isFinite(stay.booked.total) && stay.booked.total > 0 ? stay.booked.total : null;
  const nights = (Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / 86400000;
  return {...pending, currency, total, bookedTotal,
    difference: bookedTotal === null ? null : round(bookedTotal - total),
    averageNight: Number.isInteger(nights) && nights > 0 ? round(total / nights) : null,
    nights: Number.isInteger(nights) && nights > 0 ? nights : null,
    referenceRoomAmount: includedFees === null ? null : round(total - includedFees),
    basis: 'tax-included', manual: true};
}

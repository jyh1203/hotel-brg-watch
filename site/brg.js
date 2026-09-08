export const policyUrl = 'https://www.marriott.com/online-hotel-booking.mi';
export function threshold(base, currency = 'EUR') {
  const unit = currency === 'JPY' ? 1 : 0.01;
  const boundary = base * 0.99;
  const max = (Math.ceil((boundary - 1e-8) / unit) - 1) * unit;
  return { boundary, max: Math.round(max / unit) * unit, percent: 1, inclusive: false };
}
export function assess(base, offer, { currency = 'EUR', verified = false, fresh = false } = {}) {
  if (![base, offer].every(n => Number.isFinite(n) && n > 0)) return { status: '금액 확인 필요' };
  const limit = threshold(base, currency);
  const pass = offer <= limit.max + 1e-8;
  return { ...limit, difference: base - offer, percentDifference: (base - offer) / base * 100,
    status: !pass ? '가격 기준 미달' : verified && fresh ? '가격 기준 충족 · Marriott 심사 필요' : '가격 차이 충족 · 조건 확인 필요',
    discountAmount: offer * 0.75, pass };
}

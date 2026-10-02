export const policyUrl = 'https://www.marriott.com/online-hotel-booking.mi';
export function threshold(base, exchanged = false, currency = 'EUR') {
  const unit = currency === 'JPY' ? 1 : 0.01;
  const boundary = base * (exchanged ? 0.98 : 0.99);
  const max = (exchanged ? Math.floor((boundary + 1e-8) / unit) : Math.ceil((boundary - 1e-8) / unit) - 1) * unit;
  return { boundary, max: Math.round(max / unit) * unit, percent: exchanged ? 2 : 1, inclusive: exchanged };
}
export function assess(base, offer, { currency = 'EUR', exchanged = false, verified = false, fresh = false } = {}) {
  if (![base, offer].every(n => Number.isFinite(n) && n > 0)) return { status: '금액 확인 필요' };
  const limit = threshold(base, exchanged, currency);
  const pass = offer <= limit.max + 1e-8;
  return { ...limit, difference: base - offer, percentDifference: (base - offer) / base * 100,
    status: !pass ? '가격 기준 미달' : verified && fresh ? '가격 기준 충족 · Marriott 심사 필요' : '가격 차이 충족 · 조건 확인 필요',
    discountAmount: offer * 0.75, pass };
}

export function assessRate({
  officialSubtotal,
  offer,
  currency = 'EUR',
  offerCurrency = currency,
  amountBasis = 'unknown',
  roomMatch = null,
  cancellationMatch = null,
  stale = false,
  claimWindow = 'unknown'
} = {}) {
  const price = assess(officialSubtotal, offer, { currency, exchanged: offerCurrency !== currency });
  const hardStops = [];
  const reviews = [];
  if (claimWindow === 'expired') hardStops.push('예약 후 24시간 접수기한 경과');
  if (roomMatch === false) hardStops.push('객실·침대 조건 불일치');
  if (cancellationMatch === false) hardStops.push('취소·환불 조건 불일치');
  if (price.pass === false) hardStops.push('가격 차이 기준 미달');
  if (offerCurrency !== currency) reviews.push('통화 환산 수동 검토');
  if (amountBasis !== 'tax-exclusive') reviews.push('숙박 전체 세전 객실료 미확인');
  if (roomMatch == null) reviews.push('객실·침대 조건 미확인');
  if (cancellationMatch == null) reviews.push('취소·환불 조건 미확인');
  if (stale) reviews.push('과거 수집값');
  if (claimWindow === 'unknown') reviews.push('신청기한 미확인');
  const tone = hardStops.length ? 'no' : reviews.length ? 'review' : price.pass ? 'yes' : 'review';
  const label = tone === 'no' ? '신청 불가' : tone === 'yes' ? '신청 가능 후보' : '조건 확인 필요';
  return {
    ...price,
    tone,
    label,
    reasons: [...hardStops, ...reviews],
    priceLabel: price.pass === true ? '가격 기준 충족' : price.pass === false ? '가격 기준 미달' : '가격 미확인'
  };
}

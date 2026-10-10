export const policyUrl = 'https://www.marriott.com/online-hotel-booking.mi';
export function threshold(base, currency = 'EUR') {
  const unit = currency === 'JPY' ? 1 : 0.01;
  const boundary = base * 0.99;
  const max = (Math.ceil((boundary - 1e-8) / unit) - 1) * unit;
  return { boundary, max: Math.round(max / unit) * unit, percent: 1, inclusive: false };
}
export function assess(base, offer, { currency = 'EUR', offerCurrency = currency, verified = false, fresh = false } = {}) {
  if (offerCurrency !== currency) return { status: '통화 조건 수동 확인', pass: undefined, currencyMismatch: true };
  if (![base, offer].every(n => Number.isFinite(n) && n > 0)) return { status: '금액 확인 필요' };
  const limit = threshold(base, currency);
  const pass = offer <= limit.max + 1e-8;
  return { ...limit, difference: base - offer, percentDifference: (base - offer) / base * 100,
    status: !pass ? '가격 기준 미달' : verified && fresh ? '가격 기준 충족 · Marriott 심사 필요' : '가격 차이 충족 · 조건 확인 필요',
    discountAmount: offer * 0.75, pass };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const matches = (text, pattern) => new RegExp(pattern, 'i').test(text ?? '');

function deadlineDate(value, fallbackYear) {
  const iso = String(value ?? '').match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const named = String(value ?? '').match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:,\s*(20\d{2}))?/i);
  if (!named) return null;
  const year = Number(named[3] ?? fallbackYear);
  const month = MONTHS[named[1].slice(0, 3).toLowerCase()];
  return `${year}-${String(month).padStart(2, '0')}-${String(Number(named[2])).padStart(2, '0')}`;
}

export function candidateEvidence(stay, candidate) {
  const context = candidate?.context ?? '';
  const roomPatterns = stay?.match?.roomPatterns ?? [];
  const bedPatterns = stay?.match?.bedPatterns ?? [];
  const excludedPatterns = stay?.match?.excludedPatterns ?? [];
  const missingRoomPatterns = roomPatterns.filter((pattern) => !matches(context, pattern));
  const missingBedPatterns = bedPatterns.filter((pattern) => !matches(context, pattern));
  const excludedMatches = excludedPatterns.filter((pattern) => matches(context, pattern));
  const expectedDeadline = deadlineDate(stay?.booked?.cancellationDeadline, stay?.checkIn?.slice(0, 4));
  const offeredDeadline = candidate?.cancellationDeadline ?? deadlineDate(context, stay?.checkIn?.slice(0, 4));
  const cancellationMatched = stay?.match?.requireFreeCancellation
    ? candidate?.freeCancellation === true && (!expectedDeadline || (Boolean(offeredDeadline) && offeredDeadline === expectedDeadline))
    : true;
  return {
    roomMatched: missingRoomPatterns.length === 0 && missingBedPatterns.length === 0 && excludedMatches.length === 0,
    cancellationMatched,
    expectedDeadline,
    offeredDeadline,
    missingRoomPatterns,
    missingBedPatterns,
    excludedMatches
  };
}

export function auditGoogleOffer({ stay, result, candidate, official, stale = false }) {
  const currency = stay.booked.currency;
  const candidateAmount = candidate?.preTaxVerified === true && Number.isFinite(candidate?.preTaxAmount)
    ? candidate.preTaxAmount
    : candidate?.amountBasis === 'pre-tax'
      ? candidate?.totalAmount
      : null;
  const officialAmount = official?.totalAmount;
  const sameCurrency = candidate?.currency === currency && (!official?.currency || official.currency === currency);
  const evidence = candidateEvidence(stay, candidate);
  const nights = Math.round((Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / 86400000);
  const datesMatched = result?.dateConfirmed === true && result?.searchEvidence?.checkIn === stay.checkIn && result?.searchEvidence?.checkOut === stay.checkOut;
  const occupancyMatched = result?.occupancyConfirmed === true && result?.searchEvidence?.adults === stay.adults && result?.searchEvidence?.children === 0;
  const price = assess(stay.booked.roomSubtotal, candidateAmount, {
    currency,
    offerCurrency: candidate?.currency,
    verified: false,
    fresh: !stale
  });
  const checks = [
    { key: 'fresh', label: '24시간 이내 최신 수집', ok: !stale },
    { key: 'currency', label: '동일 통화', ok: sameCurrency },
    { key: 'dates', label: '동일 체크인·체크아웃', ok: datesMatched },
    { key: 'nights', label: '동일 숙박일수', ok: result?.nights === nights },
    { key: 'occupancy', label: '동일 투숙 인원', ok: occupancyMatched },
    { key: 'rooms', label: '동일 객실 수', ok: result?.roomCountConfirmed === true && result?.searchEvidence?.rooms === 1 },
    { key: 'room', label: '동일 객실·침대', ok: evidence.roomMatched },
    { key: 'cancellation', label: '동일 무료취소 기한', ok: evidence.cancellationMatched },
    { key: 'basis', label: '세금·수수료 제외 총액', ok: candidate?.amountBasis === 'pre-tax' || candidate?.preTaxVerified === true },
    { key: 'provider', label: '판매처 확인', ok: Boolean(candidate?.provider) && candidate?.official !== true },
    { key: 'public', label: '회원·앱 전용이 아닌 공개 요금', ok: candidate?.publicRate === true },
    { key: 'available', label: '결제 직전 실제 예약 가능', ok: candidate?.availabilityVerified === true }
  ];
  const verified = checks.every((check) => check.ok === true);
  const lowerThanOfficial = sameCurrency && Number.isFinite(candidateAmount) && Number.isFinite(officialAmount)
    ? candidateAmount < officialAmount - 0.005
    : false;
  const officialDifference = lowerThanOfficial ? officialAmount - candidateAmount : null;
  const officialDifferencePercent = lowerThanOfficial && officialAmount > 0 ? officialDifference / officialAmount * 100 : null;
  const blockers = checks.filter((check) => check.ok !== true);
  let status = candidate?.amountBasis === 'tax-included' && !candidate?.preTaxVerified
    ? 'Google 세금 포함 총액 확인 · 세전 금액 확인 필요'
    : 'Google 가격 확인 필요';
  if (lowerThanOfficial && price.pass && verified) status = 'BRG 가격·조건 검증 완료 · Marriott 심사 필요';
  else if (lowerThanOfficial && price.pass) status = 'Google 저가 발견 · BRG 조건 확인 필요';
  else if (lowerThanOfficial) status = '공식 현행가보다 낮지만 내 예약 BRG 가격 기준 미달';
  else if (Number.isFinite(candidateAmount) && Number.isFinite(officialAmount)) status = 'Google 검증 후보가 공식 현행가보다 낮지 않음';
  return { ...price, comparisonAmount: candidateAmount, evidence, checks, blockers, verified, lowerThanOfficial, officialDifference, officialDifferencePercent, status };
}

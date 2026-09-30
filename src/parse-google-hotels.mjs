const FREE_CANCEL = /free cancellation|무료\s*취소/i;
const MONEY = {
  KRW: /(?:₩|KRW\s?)([\d,]+(?:\.\d+)?)/i,
  EUR: /(?:€|EUR\s?)([\d,]+(?:\.\d+)?)/i,
  JPY: /(?:¥|￥|JPY\s?)([\d,]+(?:\.\d+)?)/i
};

const clean = (value) => value.replace(/\s+/g, " ").trim();
const amount = (line, currency) => {
  const match = line.match(MONEY[currency] ?? MONEY.KRW);
  return match ? Number(match[1].replaceAll(",", "")) : null;
};

export function nightsBetween(checkIn, checkOut) {
  return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const matches = (text, pattern) => new RegExp(pattern, "i").test(text);

function cancellationDeadline(context, stay) {
  const match = context.match(/(?:until|before(?: or on)?)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:,\s*(20\d{2}))?/i);
  if (!match) return null;
  const year = Number(match[3] ?? stay.checkIn.slice(0, 4));
  const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
  return `${year}-${String(month).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
}

function expectedCancellationDeadline(stay) {
  return stay.booked?.cancellationDeadline?.match(/20\d{2}-\d{2}-\d{2}/)?.[0] ?? null;
}

function matchEvidence(context, freeCancellation, stay) {
  const roomPatterns = stay.match?.roomPatterns ?? [];
  const bedPatterns = stay.match?.bedPatterns ?? [];
  const excludedPatterns = stay.match?.excludedPatterns ?? [];
  const missingRoomPatterns = roomPatterns.filter((pattern) => !matches(context, pattern));
  const missingBedPatterns = bedPatterns.filter((pattern) => !matches(context, pattern));
  const excludedMatches = excludedPatterns.filter((pattern) => matches(context, pattern));
  const offeredDeadline = cancellationDeadline(context, stay);
  const expectedDeadline = expectedCancellationDeadline(stay);
  const cancellationMatched = stay.match?.requireFreeCancellation
    ? freeCancellation && (!expectedDeadline || (Boolean(offeredDeadline) && offeredDeadline === expectedDeadline))
    : true;
  return {
    roomMatched: missingRoomPatterns.length === 0 && missingBedPatterns.length === 0 && excludedMatches.length === 0,
    cancellationMatched,
    missingRoomPatterns,
    missingBedPatterns,
    excludedMatches,
    offeredDeadline,
    expectedDeadline
  };
}

function explicitAmountBasis(text) {
  if (/prices? (?:shown )?(?:include|including) taxes(?: and|\s*\+) fees/i.test(text)) return "tax-included";
  if (/prices? (?:shown )?(?:exclude|excluding) taxes(?: and|\s*\+) fees/i.test(text)) return "pre-tax";
  return "unknown";
}

function dateRangeConfirmed(text, stay) {
  const label = (iso) => {
    const [year, month, day] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, month - 1, day)));
  };
  const normalized = clean(text).toLowerCase();
  return normalized.includes(label(stay.checkIn).toLowerCase()) && normalized.includes(label(stay.checkOut).toLowerCase());
}

export function parseGoogleHotelPrices(text, stay, currency = stay.booked?.currency ?? "KRW") {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const nights = nightsBetween(stay.checkIn, stay.checkOut);
  const start = lines.findIndex((line) => /Sponsored.*Featured options/i.test(line));
  const allStart = lines.findIndex((line) => /^All options$/i.test(line));
  const allEnd = lines.findIndex((line, index) => index > allStart && /^Track this hotel$/i.test(line));
  const roomArea = lines.slice(Math.max(0, start + 1), allStart > 0 ? allStart : lines.length);
  const optionArea = lines.slice(allStart + 1, allEnd > allStart ? allEnd : lines.length);
  const amountBasis = explicitAmountBasis(text);

  const providers = [];
  for (let i = 1; i < optionArea.length; i += 1) {
    const price = amount(optionArea[i], currency);
    if (!price) continue;
    const provider = optionArea[i - 1];
    if (/visit site|room|bed|cancellation|nightly|taxes|fees/i.test(provider) || !/[a-z]{2}/i.test(provider)) continue;
    providers.push({ provider, currency, nightlyAmount: price, totalAmount: price * nights, amountBasis, estimatedFromNightly: true, source: "google-hotels", official: /marriott|official site/i.test(provider), publicRate: !/member|mobile|app|sign[ -]?in|loyalty/i.test(provider), availabilityVerified: false });
  }

  const roomRates = [];
  for (let i = 0; i < roomArea.length; i += 1) {
    const price = amount(roomArea[i], currency);
    if (!price) continue;
    let begin = i - 1;
    while (begin >= 0 && !/visit site/i.test(roomArea[begin]) && amount(roomArea[begin], currency) == null) begin -= 1;
    const context = clean(roomArea.slice(begin + 1, i + 1).join(" · "));
    const freeCancellation = FREE_CANCEL.test(context);
    const evidence = matchEvidence(context, freeCancellation, stay);
    roomRates.push({
      amountBasis,
      estimatedFromNightly: true,
      currency,
      nightlyAmount: price,
      totalAmount: price * nights,
      context,
      freeCancellation,
      cancellationDeadline: evidence.offeredDeadline,
      matchEvidence: evidence,
      provider: null,
      publicRate: null,
      availabilityVerified: false
    });
  }
  let activeProvider = null;
  for (const rate of roomRates) {
    const providerOnly = rate.context.match(/^([^·€¥₩]+?)\s*·\s*(?:€|¥|￥|₩|EUR|JPY|KRW)/i)?.[1]?.trim();
    if (providerOnly && !/room|bed|cancellation|breakfast|wi-?fi/i.test(providerOnly)) {
      activeProvider = providerOnly;
      rate.provider = activeProvider;
    } else if (activeProvider) {
      rate.provider = activeProvider;
    }
    if (rate.provider) {
      rate.publicRate = !/member|mobile|app|sign[ -]?in|loyalty/i.test(rate.context);
    }
  }

  const officialReference = providers.filter(rate => rate.official).sort((a,b) => a.totalAmount - b.totalAmount)[0] ?? null;
  const lowestProvider = providers.filter(rate => !rate.official).sort((a, b) => a.totalAmount - b.totalAmount)[0] ?? null;
  const freeCancellation = roomRates.filter((rate) => rate.freeCancellation).sort((a, b) => a.totalAmount - b.totalAmount)[0] ?? null;
  const exactCandidates = roomRates.filter((rate) => rate.matchEvidence.roomMatched && rate.matchEvidence.cancellationMatched)
    .sort((a, b) => a.totalAmount - b.totalAmount);

  return {
    nights,
    officialReference,
    providers,
    roomRates,
    lowestProvider,
    freeCancellation,
    exactCandidate: exactCandidates[0] ?? null,
    dateConfirmed: dateRangeConfirmed(text, stay)
  };
}

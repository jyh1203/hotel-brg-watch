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

export function parseGoogleHotelPrices(text, stay, currency = stay.booked?.currency ?? "KRW") {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const nights = nightsBetween(stay.checkIn, stay.checkOut);
  const start = lines.findIndex((line) => /Sponsored.*Featured options/i.test(line));
  const allStart = lines.findIndex((line) => /^All options$/i.test(line));
  const allEnd = lines.findIndex((line, index) => index > allStart && /^Track this hotel$/i.test(line));
  const roomArea = lines.slice(Math.max(0, start + 1), allStart > 0 ? allStart : lines.length);
  const optionArea = lines.slice(allStart + 1, allEnd > allStart ? allEnd : lines.length);

  const providers = [];
  for (let i = 1; i < optionArea.length; i += 1) {
    const price = amount(optionArea[i], currency);
    if (!price) continue;
    const provider = optionArea[i - 1];
    if (/visit site|room|bed|cancellation/i.test(provider)) continue;
    providers.push({ provider, currency, nightlyAmount: price, totalAmount: price * nights });
  }

  const roomRates = [];
  for (let i = 0; i < roomArea.length; i += 1) {
    const price = amount(roomArea[i], currency);
    if (!price) continue;
    const context = clean(roomArea.slice(Math.max(0, i - 3), Math.min(roomArea.length, i + 3)).join(" · "));
    roomRates.push({
      currency,
      nightlyAmount: price,
      totalAmount: price * nights,
      context,
      freeCancellation: FREE_CANCEL.test(context)
    });
  }

  const lowestProvider = providers.sort((a, b) => a.totalAmount - b.totalAmount)[0] ?? null;
  const freeCancellation = roomRates.filter((rate) => rate.freeCancellation).sort((a, b) => a.totalAmount - b.totalAmount)[0] ?? null;
  const exactCandidates = roomRates.filter((rate) => {
    if (stay.match.requireFreeCancellation && !rate.freeCancellation) return false;
    return stay.match.roomPatterns.every((pattern) => new RegExp(pattern, "i").test(rate.context));
  }).sort((a, b) => a.totalAmount - b.totalAmount);

  return {
    nights,
    providers,
    roomRates,
    lowestProvider,
    freeCancellation,
    exactCandidate: exactCandidates[0] ?? null,
    dateConfirmed: text.includes(stay.checkIn.slice(5).replace("-", "/")) || text.includes(stay.checkIn.slice(0, 4))
  };
}

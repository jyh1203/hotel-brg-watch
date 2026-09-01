const bytes = (value) => [...Buffer.from(value, "utf8")];

function varint(value) {
  const result = [];
  let n = Number(value);
  do {
    let byte = n & 0x7f;
    n = Math.floor(n / 128);
    if (n) byte |= 0x80;
    result.push(byte);
  } while (n);
  return result;
}

const field = (tag, payload) => [(tag << 3) | 2, ...varint(payload.length), ...payload];

function dateField(tag, isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return field(tag, [8, ...varint(year), 16, ...varint(month), 24, ...varint(day)]);
}

export function buildTravelState(stay, currency = "KRW") {
  const location = field(1, field(2, [
    ...field(1, bytes(stay.city.googleEntityId)),
    ...field(7, bytes(stay.city.name))
  ]));
  const dates = field(2, [
    ...field(2, [...dateField(1, stay.checkIn), ...dateField(2, stay.checkOut)]),
    24, ...varint(stay.adults)
  ]);
  const rooms = field(6, [8, 1]);
  const currencyBlock = field(5, field(1, [58, ...field(7, bytes(currency)).slice(2)]));
  const body = [...location, 26, 0, ...dates, ...rooms, ...currencyBlock, 26, 0];
  return Buffer.from([8, 1, ...field(3, body)]).toString("base64url");
}

export function buildGoogleHotelsUrl(stay, currency = "KRW") {
  const params = new URLSearchParams({
    q: stay.hotel,
    adults: String(stay.adults),
    hl: "en",
    ts: buildTravelState(stay, currency)
  });
  return `https://www.google.com/travel/search?${params}`;
}

export function buildPriceDetailUrl(searchUrl, hotelHref) {
  const detail = new URL(hotelHref, searchUrl);
  detail.searchParams.set("ap", "ugEGcHJpY2Vz");
  return detail.toString();
}

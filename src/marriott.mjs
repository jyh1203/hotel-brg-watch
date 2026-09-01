import { nightsBetween } from "./parse-google-hotels.mjs";

const number = (value) => Number(value.replaceAll(",", ""));

function usDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

export function buildMarriottRoomsUrl(stay) {
  const { propertyCode, slug } = stay.marriott;
  return `https://www.marriott.com/en-us/hotels/${propertyCode.toLowerCase()}-${slug}/rooms/`;
}

export function buildMarriottAvailabilityUrl(stay) {
  const fromDate = usDate(stay.checkIn);
  const toDate = usDate(stay.checkOut);
  const params = new URLSearchParams({
    lengthOfStay: String(nightsBetween(stay.checkIn, stay.checkOut)),
    fromDate,
    toDate,
    numberOfRooms: "1",
    numberOfAdults: String(stay.adults),
    guestCountBox: `${stay.adults} Adults Per Room`,
    childrenCountBox: "0 Children Per Room",
    roomCountBox: "1 Rooms",
    childrenCount: "0",
    childrenAges: "",
    clusterCode: "none",
    corporateCode: "",
    groupCode: "",
    isHwsGroupSearch: "true",
    propertyCode: stay.marriott.propertyCode,
    useRewardsPoints: "false",
    flexibleDateSearch: "false",
    "t-start": fromDate,
    "t-end": toDate,
    fromDateDefaultFormat: fromDate,
    toDateDefaultFormat: toDate,
    fromToDate_submit: toDate,
    fromToDate: fromDate,
    roomPoolCode: stay.marriott.roomPoolCode
  });
  return `https://www.marriott.com/reservation/availabilitySearch.mi?${params}`;
}

export function parseMarriottRate(text) {
  const selected = text.match(
    /Currently Selected Room\s+([\s\S]*?)\s+Room Details\s+Rates from\s+([\d,.]+)\s*([A-Z]{3})\s*Avg\s*\/\s*Night\s+([\d,.]+)\s+Total Per Room/i
  );
  if (!selected) return null;
  return {
    room: selected[1].replace(/\s+/g, " ").trim(),
    nightlyAmount: number(selected[2]),
    currency: selected[3].toUpperCase(),
    totalAmount: number(selected[4]),
    taxesIncluded: false
  };
}

export async function collectMarriottRate(context, stay, fx) {
  const sourceUrl = buildMarriottAvailabilityUrl(stay);
  const officialUrl = buildMarriottRoomsUrl(stay);
  const page = await context.newPage();
  try {
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    let text = "";
    for (let attempt = 0; attempt < 65; attempt += 1) {
      text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      if (text.includes("Total Per Room") || text.includes("Access Denied")) break;
      await page.waitForTimeout(1000);
    }
    if (text.includes("Access Denied")) throw new Error("Marriott가 자동 접속을 차단했습니다.");
    const rate = parseMarriottRate(text);
    if (!rate) throw new Error("동일 객실의 Marriott 공식가를 찾지 못했습니다.");
    if (rate.currency !== stay.booked.currency) {
      throw new Error(`공식가 통화 불일치 (${rate.currency})`);
    }
    return {
      status: "ok",
      ...rate,
      totalKrw: Math.round(rate.totalAmount * fx.rates[rate.currency]),
      sourceUrl,
      officialUrl,
      note: "Marriott 공개 최저 일반요금. 기본 화면은 세금·요금 제외 표시이므로 BRG 제출 전 결제 단계 총액 확인 필요"
    };
  } catch (error) {
    return { status: "error", error: error.message, sourceUrl, officialUrl };
  } finally {
    await page.close();
  }
}

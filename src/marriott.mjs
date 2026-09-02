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
  const selected = text.match(/Currently Selected Room\s+([\s\S]*?)\s+Room Details/i);
  const flexible = text.match(
    /Flexible Rate(?:\s+MOST POPULAR)?\s+([\s\S]*?)(?=\s+Prepay|\s+Stay for Breakfast Rate|\s+Other Available Room\(s\)|$)/i
  );
  if (!selected || !flexible || !/Free cancellation/i.test(flexible[1])) return null;
  const member = flexible[1].match(
    /(?:^|\n)Member Rate\s+([\d,.]+)\s*([A-Z]{3})\s*Avg\s*\/\s*Night\s+([\d,.]+)\s+Total Per Room/im
  );
  if (!member) return null;
  const cancellation = flexible[1].match(/Free cancellation[^\n]*/i)?.[0] ?? "Free cancellation";
  return {
    room: selected[1].replace(/\s+/g, " ").trim(),
    rateName: "Member Flexible Rate",
    cancellation,
    nightlyAmount: number(member[1]),
    currency: member[2].toUpperCase(),
    totalAmount: number(member[3]),
    taxesIncluded: false,
    prepaid: false
  };
}

async function expandSelectedRoomRates(page) {
  const button = page.locator('button[data-testid="rate-button"]').first();
  await button.waitFor({ state: "visible", timeout: 60000 });
  await page.waitForTimeout(1500);
  await button.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1000);
  let text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (/Flexible Rate/i.test(text)) return text;

  // Marriott의 React 카드가 일반 자동 클릭을 무시하는 경우 실제 onClick을 호출한다.
  await button.evaluate((element) => {
    const key = Object.keys(element).find((name) => name.startsWith("__reactProps"));
    const onClick = key && element[key]?.onClick;
    if (typeof onClick !== "function") return;
    onClick({
      preventDefault() {},
      stopPropagation() {},
      currentTarget: element,
      target: element
    });
  });
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await page.waitForTimeout(1000);
    text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (/Flexible Rate/i.test(text) || /Access Denied/i.test(text)) break;
  }
  return text;
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
    text = await expandSelectedRoomRates(page);
    const rate = parseMarriottRate(text);
    if (!rate) throw new Error("동일 객실의 회원 변경 가능·무료취소 공식가를 찾지 못했습니다.");
    if (rate.currency !== stay.booked.currency) {
      throw new Error(`공식가 통화 불일치 (${rate.currency})`);
    }
    return {
      status: "ok",
      ...rate,
      totalKrw: Math.round(rate.totalAmount * fx.rates[rate.currency]),
      sourceUrl,
      officialUrl,
      note: "Marriott 회원 변경 가능·무료취소 요금. 선불·비환불 요금 제외; 세금·요금은 호텔별 예약 기준으로 추정"
    };
  } catch (error) {
    return { status: "error", error: error.message, sourceUrl, officialUrl };
  } finally {
    await page.close();
  }
}

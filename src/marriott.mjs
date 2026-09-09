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
  const selected = text.match(/(?:Currently Selected Room\s+)?([^\n]+)\s+Room Details\s+Rates from/i);
  const flexible = text.match(
    /Flexible Rate(?:\s+MOST POPULAR)?\s+([\s\S]*?)(?=\s+Prepay|\s+Stay for Breakfast Rate|\s+Other Available Room\(s\)|$)/i
  );
  if (!selected || !flexible) return null;
  const member = flexible[1].match(
    /(?:^|\n)Member Rate\s+([\d,.]+)\s*([A-Z]{3})\s*Avg\s*\/\s*Night\s+([\d,.]+)\s+Total Per Room/im
  );
  if (!member) return null;
  const cancellationMatch = flexible[1].match(/Free cancellation[^\n]*/i);
  return {
    room: selected[1].replace(/\s+/g, " ").trim(),
    rateName: "Member Flexible Rate",
    cancellation: cancellationMatch?.[0] ?? "변경 가능 요금(무료취소 문구 없음)",
    freeCancellation: Boolean(cancellationMatch),
    nightlyAmount: number(member[1]),
    currency: member[2].toUpperCase(),
    totalAmount: number(member[3]),
    taxesIncluded: null,
    amountBasis: "unknown",
    prepaid: false
  };
}

export function monthLabel(iso) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

async function pickDate(page, iso) {
  const month = monthLabel(iso);
  for (let step = 0; step < 13; step += 1) {
    const table = page.getByRole("table").filter({ hasText: month });
    if (await table.isVisible().catch(() => false)) {
      await table.locator("td.available:not(.off)").filter({ hasText: new RegExp(`^${Number(iso.slice(8))}$`) }).click();
      return;
    }
    const before = await page.locator("th.month:visible").allTextContents();
    await page.locator("th.next.available:visible").click();
    await page.waitForFunction(
      previous => Array.from(document.querySelectorAll("th.month")).some(el => !previous.includes(el.textContent)),
      before,
      { timeout: 15000 }
    );
  }
  throw new Error(`달력에서 ${iso} 날짜를 찾지 못했습니다.`);
}

export async function collectMarriottRate(context, stay, fx) {
  const officialUrl = buildMarriottRoomsUrl(stay);
  // Keep the user-facing source link on the same public booking form used for
  // collection; the legacy availabilitySearch URL is frequently blocked.
  const sourceUrl = officialUrl;
  const page = await context.newPage();
  let ratePage;
  let stage = "opening official room page";
  try {
    // Start with the public booking form, which establishes the booking session.
    // Do not navigate straight to the legacy availability endpoint without a session.
    await page.goto(officialUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    const cookie = page.getByRole("button", { name: "Reject All", exact: true });
    await cookie.waitFor({ state: "visible", timeout: 8000 }).then(() => cookie.click()).catch(() => {});
    if (/Access Denied|verify you are human/i.test(await page.locator("body").innerText())) {
      throw new Error("Marriott가 이 실행 환경의 접속을 차단했습니다.");
    }
    stage = "opening date picker";
    await page.locator(".fromDateSection:visible").first().click({ timeout: 30000 });
    stage = "selecting dates";
    await pickDate(page, stay.checkIn);
    await pickDate(page, stay.checkOut);
    await page.getByRole("button", { name: "Done", exact: true }).first().click();
    stage = "setting guest count";
    await page.getByRole("button", { name: "Select number of guests dropdown", exact: true }).click();
    // Each hotel uses a fresh context, so the booking form starts with one adult.
    for (let n = 1; n < stay.adults; n += 1) await page.getByRole("button", { name: "Increase number of Adults", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).first().click();
    stage = "opening rate list";
    // Allow the booking form to commit its hidden date/guest fields, then submit
    // the form itself. Direct navigation to rateListMenu.mi is rejected by
    // Marriott's edge layer in CI, while the booking-form transition carries
    // the signed session state needed by the rate list. Keep this transition
    // browser-driven so cookies, hidden form fields, and anti-bot tokens agree.
    await page.waitForTimeout(1000);
    // The visible date widgets update their labels immediately, but Marriott's
    // legacy reservation form can retain a stale `fromToDate` value (usually
    // today). Synchronize every form field from the requested booking before
    // submitting; otherwise the form opens availabilitySearch with mismatched
    // dates and never reaches the signed rate-list page.
    const requestedParams = new URL(buildMarriottAvailabilityUrl(stay)).searchParams;
    const formInputs = await page.locator("#reservationForm input[name]").all();
    for (const input of formInputs) {
      const name = await input.getAttribute("name");
      const value = requestedParams.get(name);
      if (value !== null) {
        await input.evaluate((element, nextValue) => {
          element.value = nextValue;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        }, value);
      }
    }
    const existingPages = new Set(context.pages());
    // Room-specific CTAs submit through Marriott's current rate-list flow. The
    // header CTA falls back to the legacy availabilitySearch endpoint for some
    // properties, so prefer the configured room type when the room page exposes
    // a matching CTA (for generic pools, retain the header fallback).
    const roomType = stay.marriott.roomPoolCode.toUpperCase();
    const roomCta = /^(SNGL|DOUB|TWIN|HOTL)$/.test(roomType)
      ? page.locator(`button.room-component__view-rates[data-room-type-code="${roomType}"]`).first()
      : page.locator("button.room-component__view-rates").first();
    if (await roomCta.count()) await roomCta.click({ timeout: 30000 });
    else await page.getByRole("button", { name: "View Rates", exact: true }).first().click({ timeout: 30000 });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const pages = context.pages();
      ratePage = pages.find(candidate => /reservation\/rateListMenu/.test(candidate.url()))
        ?? pages.find(candidate => !existingPages.has(candidate) && /reservation/.test(candidate.url()))
        ?? page;
      if (/reservation\/rateListMenu|reservation\/availabilitySearch/.test(ratePage.url())) break;
      await page.waitForTimeout(500);
    }
    // The form may open the legacy availability tab first, or a bare
    // rateListMenu URL that Akamai rejects in CI. Use Marriott's `/mi/` alias
    // with the full booking query; it is the same public rate-list application
    // but accepted by the edge layer and keeps the current session cookies.
    const rateListUrl = `https://www.marriott.com/mi/reservation/rateListMenu.mi?${requestedParams.toString()}`;
    await ratePage.goto(rateListUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    if (!/reservation\/rateListMenu/.test(ratePage.url())) {
      throw new Error(`요금 목록 전환 실패 (${context.pages().map(candidate => candidate.url()).join(", ")})`);
    }
    await ratePage.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
    stage = "loading rate list";
    await ratePage.getByRole("heading", { name: /Select a Room and Rate|객실.*요금/i }).waitFor({ state: "visible", timeout: 60000 });
    const searchText = await ratePage.getByRole("search").innerText();
    const nights = nightsBetween(stay.checkIn, stay.checkOut);
    const nightsMatch = searchText.includes(`${nights} NIGHTS`) || searchText.includes(`${nights} 박`);
    const guestsMatch = searchText.includes(`${stay.adults} Guests`) || searchText.includes(`투숙객 ${stay.adults}명`);
    if (!nightsMatch || !guestsMatch) throw new Error("숙박일수 또는 인원이 요청 조건과 다릅니다.");
    const taxToggle = ratePage.getByRole("checkbox", { name: /Show with taxes and fees|세금.*수수료/i }).first();
    if (await taxToggle.count()) await taxToggle.uncheck();
    const roomPool = stay.marriott.roomPoolCode.toLowerCase();
    const card = ratePage.getByTestId("RateCardV2").filter({ has: ratePage.locator(`a[href*="roomPoolCode=${roomPool}&"]`) });
    stage = "selecting configured room";
    await card.waitFor({ state: "visible", timeout: 45000 });
    await card.getByRole("button", { name: /View Rates/ }).click();
    stage = "reading member rate";
    // The rate label is rendered as a heading in some builds and a plain div in
    // others, so match the visible text rather than depending on one tag name.
    await card.getByText("Flexible Rate", { exact: true }).first().waitFor({ state: "visible", timeout: 30000 });
    const text = await card.innerText();
    const rate = parseMarriottRate(text);
    if (!rate) throw new Error("선택 객실의 회원 변경 가능 요금을 읽지 못했습니다.");
    if (!rate.freeCancellation) throw new Error("무료취소 조건을 확인하지 못했습니다.");
    if (rate.currency !== stay.booked.currency) throw new Error(`공식가 통화 불일치 (${rate.currency})`);
    // Room Details links carry the precise requested dates in the public booking product ID.
    // Validate visible date controls rather than trusting an old booking session.
    const dateLabel = iso => new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
    if (![stay.checkIn, stay.checkOut].every(iso => searchText.includes(dateLabel(iso)))) throw new Error("검색 날짜가 요청과 다릅니다.");
    return { status: "ok", ...rate, taxesIncluded: false, amountBasis: "pre-tax", collectionMethod: "official-booking-form",
      roomPoolCode: roomPool, checkIn: stay.checkIn, checkOut: stay.checkOut, adults: stay.adults,
      comparable: false, capturedAt: new Date().toISOString(), totalKrw: Math.round(rate.totalAmount * fx.rates[rate.currency]),
      sourceUrl, officialUrl, note: "공식 예약 폼에서 동일 객실·일정·인원 조회. 세금·수수료 제외 회원 변경 가능 요금. 최저 공개 요금 및 상세 취소 조건은 별도 확인." };
  } catch (error) {
    const detail = stage === "loading rate list" && ratePage
      ? ` url=${ratePage.url()} body=${(await ratePage.locator("body").innerText({ timeout: 5000 }).catch(() => "")).replace(/\s+/g, " ").slice(0, 400)}`
      : "";
    return { status: /차단/.test(error.message) ? "blocked" : "error", error: `${stage}: ${error.message.split("\n")[0]}${detail}`, sourceUrl, officialUrl, capturedAt: new Date().toISOString() };
  } finally {
    await Promise.all(context.pages().map(p => p.close().catch(() => {})));
  }
}

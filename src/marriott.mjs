import { nightsBetween } from "./parse-google-hotels.mjs";
import { createMarriottRecorder, isMarriottRateRequestUrl } from "./marriott-artifacts.mjs";

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

export function classifyMarriottSnapshot(snapshot) {
  const text = snapshot.bodyText.toLowerCase();
  if (/access denied|permission to access/.test(text)) return "blocked";
  if (/captcha|verify you are human|are you a human|robot check/.test(text)) return "captcha";
  if (snapshot.selectors.login || /sign in to your account|log in to your account/.test(text)) return "login-required";
  if (/no rooms available|sold out|no availability/.test(text)) return "sold-out";
  if (/something went wrong|unexpected error|service is unavailable/.test(text)) return "error-page";
  if (snapshot.selectors.rateCards || /select a room and rate/.test(text)) return "rate-list";
  if (snapshot.selectors.dateInput) return "booking-form";
  if (snapshot.selectors.cookieConsent) return "cookie-consent";
  if (snapshot.selectors.roomCards || snapshot.selectors.viewRates) return "room-page-partial";
  if (snapshot.bodyLength === 0) return "blank-document";
  return "unknown";
}

async function inspectMarriottPage(page, responseStatus = null) {
  const dom = await page.evaluate(() => {
    const bodyText = document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    const visible = (selector) => [...document.querySelectorAll(selector)].some((element) => {
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none" && (element.offsetWidth || element.offsetHeight);
    });
    return {
      title: document.title ?? "",
      readyState: document.readyState,
      bodyText,
      bodyLength: bodyText.length,
      selectors: {
        dateInput: visible(".fromDateSection"),
        viewRates: visible("button.room-component__view-rates, button.applyBtn"),
        roomCards: Boolean(document.querySelector(".room-component, [data-testid=RateCardV2]")),
        rateCards: Boolean(document.querySelector("[data-testid=RateCardV2]")),
        login: visible('form[action*="login"], input[type="password"]'),
        cookieConsent: visible("#onetrust-banner-sdk, button#onetrust-reject-all-handler")
      }
    };
  }).catch(() => ({
    title: "",
    readyState: "unknown",
    bodyText: "",
    bodyLength: 0,
    selectors: { dateInput: false, viewRates: false, roomCards: false, rateCards: false, login: false, cookieConsent: false }
  }));
  const snapshot = { responseStatus, finalUrl: page.url(), ...dom };
  return { ...snapshot, state: classifyMarriottSnapshot(snapshot), bodySample: dom.bodyText.slice(0, 500) };
}

async function waitForRoomPageState(page, responseStatus, timeout = 35000) {
  const deadline = Date.now() + timeout;
  let snapshot = await inspectMarriottPage(page, responseStatus);
  while (Date.now() < deadline) {
    snapshot = await inspectMarriottPage(page, responseStatus);
    if (["booking-form", "room-page-partial", "blocked", "captcha", "login-required", "sold-out", "error-page"].includes(snapshot.state)) return snapshot;
    await page.waitForTimeout(500);
  }
  if (snapshot.state === "blank-document") return snapshot;
  return { ...snapshot, state: "dom-not-ready" };
}

export function normalizeMarriottFailureState({ errorMessage = "", stage = "", detectedState = "unknown", authMethod = "none" }) {
  if (detectedState === "blocked") return "blocked";
  if (detectedState === "captcha") return "captcha";
  if (detectedState === "login-required") return authMethod === "none" ? "login-required" : "session-expired";
  if (detectedState === "sold-out") return "room-unavailable";
  if (detectedState === "blank-document") return "blank-document";
  if (detectedState === "dom-not-ready") return "dom-not-ready";
  if (/Timeout/i.test(errorMessage) && stage === "opening official room page") return "navigation-timeout";
  if (/date picker|selecting dates/i.test(stage)) return "calendar-unavailable";
  if (/opening rate list|confirming specific dates/i.test(stage)) return "rate-list-transition-failed";
  if (/loading rate list|selecting configured room/i.test(stage)) return "rate-card-unavailable";
  if (/reading member rate/i.test(stage)) return "rate-parse-failed";
  return detectedState === "unknown" ? "dom-not-ready" : detectedState;
}

class MarriottPageStateError extends Error {
  constructor(message, snapshot) {
    super(message);
    this.snapshot = snapshot;
  }
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

async function syncReservationFields(page, stay, { dispatch = true } = {}) {
  const requestedParams = new URL(buildMarriottAvailabilityUrl(stay)).searchParams;
  const formInputs = await page.locator("#reservationForm input[name]").all();
  for (const input of formInputs) {
    const name = await input.getAttribute("name");
    const value = requestedParams.get(name);
    if (value !== null) {
      await input.evaluate((element, { nextValue, shouldDispatch }) => {
        element.value = nextValue;
        if (shouldDispatch) {
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, { nextValue: value, shouldDispatch: dispatch });
    }
  }
}

async function clickWithRealPointer(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("객실 View Rates 버튼의 화면 위치를 찾지 못했습니다.");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

export async function collectMarriottRate(context, stay, fx, options = {}) {
  const browserDiagnostics = options.browser ?? options;
  const officialUrl = buildMarriottRoomsUrl(stay);
  const debugRun = process.env.MARRIOTT_DEBUG === "1"; // CI marker keeps diagnostic runs short.
  // Keep the user-facing source link on the same public booking form used for
  // collection; the legacy availabilitySearch URL is frequently blocked.
  const sourceUrl = officialUrl;
  const initialPages = new Set(context.pages());
  // When attached to a visible dedicated Chrome, reuse its existing tab. The
  // Marriott room CTA uses a named popup; opening a second room tab can cause
  // that popup target to be reused by the wrong tab and strand the transition
  // on the rooms page instead of rateListMenu.
  const page = browserDiagnostics.authMethod === "cdp-profile" && context.pages().length
    ? context.pages()[0]
    : await context.newPage();
  const recorder = options.artifactDir ? createMarriottRecorder(context, options.artifactDir) : null;
  await recorder?.start();
  let ratePage;
  let stage = "opening official room page";
  try {
    // Start with the public booking form, which establishes the booking session.
    // Do not navigate straight to the legacy availability endpoint without a session.
    // Marriott can keep background resources open long enough that
    // DOMContentLoaded never resolves, even though the booking form is already
    // usable. Continue as soon as the main response is committed, then wait for
    // the actual form control needed by the collector.
    const response = await page.goto(officialUrl, { waitUntil: "commit", timeout: 45000 });
    await page.locator("body").waitFor({ state: "attached", timeout: 15000 });
    const cookie = page.getByRole("button", { name: "Reject All", exact: true });
    await cookie.waitFor({ state: "visible", timeout: 3000 }).then(() => cookie.click()).catch(() => {});
    const roomState = await waitForRoomPageState(page, response?.status());
    if (!["booking-form", "room-page-partial"].includes(roomState.state)) {
      throw new MarriottPageStateError(`객실 페이지 상태: ${roomState.state}`, roomState);
    }
    stage = "opening date picker";
    if (!await page.locator(".fromDateSection:visible").count()) {
      await page.getByRole("button", { name: "Check Availability", exact: true }).click({ timeout: 15000 });
      await page.locator(".fromDateSection:visible").waitFor({ state: "visible", timeout: 15000 });
    }
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
    await syncReservationFields(page, stay);
    const existingPages = new Set(context.pages());
    // Room-specific CTAs submit through Marriott's current rate-list flow. The
    // header CTA falls back to the legacy availabilitySearch endpoint for some
    // properties, so prefer the configured room type when the room page exposes
    // a matching CTA (for generic pools, retain the header fallback).
    const roomType = stay.marriott.roomPoolCode.toUpperCase();
    const roomCta = /^(SNGL|DOUB|TWIN|HOTL)$/.test(roomType)
      ? page.locator(`button.room-component__view-rates[data-room-type-code="${roomType}"]`).first()
      : page.locator("button.room-component__view-rates").first();
    if (await roomCta.count()) {
      await clickWithRealPointer(page, roomCta);
    } else {
      const fallbackCta = page.getByRole("button", { name: "View Rates", exact: true }).first();
      await clickWithRealPointer(page, fallbackCta);
    }

    // Some properties (confirmed on AC Hotel Carlton Madrid) reopen the date
    // picker after a room-specific CTA. In that state the calendar's apply
    // button changes from "Done" to "View Rates"; it is the actual submission
    // step that carries the selected room and specific dates to rateListMenu.
    // Other properties open the rate-list tab immediately, so this remains an
    // optional, short-lived confirmation step.
    const calendarViewRates = page.locator("button.applyBtn:visible").filter({ hasText: /^View Rates$/ }).first();
    const needsDateConfirmation = await calendarViewRates
      .waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (needsDateConfirmation) {
      stage = "confirming specific dates";
      // The room CTA opens a fresh Specific Dates calendar which can default
      // back to today's one-night stay even though the header form is correct.
      // Re-select the requested stay before the second View Rates submission.
      await pickDate(page, stay.checkIn);
      await pickDate(page, stay.checkOut);
      const selectedRange = await page.locator(".drp-selected:visible").innerText();
      const expectedDays = [new Date(`${stay.checkIn}T00:00:00Z`).getUTCDate(), new Date(`${stay.checkOut}T00:00:00Z`).getUTCDate()];
      if (!expectedDays.every((day) => selectedRange.includes(String(day)))) {
        throw new Error(`두 번째 달력의 선택 범위가 요청과 다릅니다 (${selectedRange})`);
      }
      await page.waitForTimeout(1000);
      await calendarViewRates.click({ timeout: 30000 });
    }

    let deadline = Date.now() + 12000;
    let transitionSnapshot;
    while (Date.now() < deadline) {
      const pages = context.pages();
      ratePage = pages.find(candidate => /reservation\/rateListMenu/.test(candidate.url()))
        ?? pages.find(candidate => !existingPages.has(candidate) && /reservation/.test(candidate.url()))
        ?? page;
      transitionSnapshot = await inspectMarriottPage(ratePage);
      if (["blocked", "captcha", "login-required", "sold-out", "error-page"].includes(transitionSnapshot.state)) {
        throw new MarriottPageStateError(`요금 전환 상태: ${transitionSnapshot.state}`, transitionSnapshot);
      }
      if (/reservation\/rateListMenu/.test(ratePage.url()) || transitionSnapshot.state === "rate-list") break;
      await page.waitForTimeout(500);
    }
    if (!/reservation\/rateListMenu/.test(ratePage.url())) {
      // Marriott's room-specific calendar intermittently closes without
      // navigating even though all requested dates are visible. Fall back to
      // the same official header form, which preserves dates and guest count,
      // then select the configured room strictly on rateListMenu.
      await Promise.all(context.pages()
        .filter((candidate) => !existingPages.has(candidate) && candidate !== page)
        .map((candidate) => candidate.close().catch(() => {})));
      const findRoom = page.getByRole("button", { name: "Find a Room", exact: true });
      await findRoom.waitFor({ state: "visible", timeout: 15000 });
      await findRoom.click({ timeout: 15000 });
      deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        ratePage = context.pages().find(candidate => /reservation\/rateListMenu/.test(candidate.url())) ?? page;
        transitionSnapshot = await inspectMarriottPage(ratePage);
        if (["blocked", "captcha", "login-required", "sold-out", "error-page"].includes(transitionSnapshot.state)) {
          throw new MarriottPageStateError(`요금 전환 상태: ${transitionSnapshot.state}`, transitionSnapshot);
        }
        if (/reservation\/rateListMenu/.test(ratePage.url()) || transitionSnapshot.state === "rate-list") break;
        await page.waitForTimeout(500);
      }
    }
    // Keep the rate-list tab opened by Marriott's own room button. Re-navigating
    // to a hand-built /mi/ URL discards the signed booking session and can trigger
    // Akamai Access Denied, especially for logged-in member rates.
    if (!/reservation\/rateListMenu/.test(ratePage.url())) {
      throw new MarriottPageStateError(
        `요금 목록 전환 실패 (${context.pages().map(candidate => candidate.url()).join(", ")})`,
        transitionSnapshot ?? await inspectMarriottPage(ratePage)
      );
    }
    await ratePage.waitForLoadState("domcontentloaded", { timeout: debugRun ? 15000 : 30000 }).catch(() => {});
    stage = "loading rate list";
    await ratePage.getByRole("heading", { name: /Select a Room and Rate|객실.*요금/i }).waitFor({ state: "visible", timeout: debugRun ? 15000 : 60000 });
    const searchRegionText = await ratePage.getByRole("search").innerText().catch(() => "");
    const searchText = searchRegionText.trim() || await ratePage.locator("body").innerText();
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
    const networkMetadata = recorder?.networkEvents
      .filter((entry) => isMarriottRateRequestUrl(entry.url))
      .slice(-20) ?? [];
    await recorder?.discardTrace();
    return { status: "ok", ...rate, taxesIncluded: false, amountBasis: "pre-tax", collectionMethod: "official-booking-form",
      roomPoolCode: roomPool, checkIn: stay.checkIn, checkOut: stay.checkOut, adults: stay.adults,
      comparable: false, capturedAt: new Date().toISOString(), totalKrw: Math.round(rate.totalAmount * fx.rates[rate.currency]),
      browser: browserDiagnostics, networkMetadata, sourceUrl, officialUrl, note: "공식 예약 폼에서 동일 객실·일정·인원 조회. 세금·수수료 제외 회원 변경 가능 요금. 최저 공개 요금 및 상세 취소 조건은 별도 확인." };
  } catch (error) {
    const body = ratePage
      ? await ratePage.locator("body").innerText({ timeout: 5000 }).catch(() => "")
      : await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const compactBody = body.replace(/\s+/g, " ").trim();
    const blocked = /access denied|verify you are human|unusual traffic|captcha|permission to access/i.test(compactBody) || /차단/.test(error.message);
    const snapshot = error.snapshot ?? await inspectMarriottPage(ratePage ?? page);
    const state = normalizeMarriottFailureState({
      errorMessage: error.message,
      stage,
      detectedState: snapshot.state,
      authMethod: browserDiagnostics.authMethod
    });
    const diagnostics = {
      ...snapshot,
      state: blocked ? "blocked" : state,
      stage,
      url: ratePage?.url() || page.url(),
      bodySample: compactBody.slice(0, 500) || snapshot.bodySample,
      browser: browserDiagnostics
    };
    await recorder?.saveFailure(ratePage ?? page, diagnostics).catch(() => {});
    return {
      status: blocked ? "blocked" : "error",
      error: `${stage}: ${error.message.split("\n")[0]}`,
      diagnostics,
      sourceUrl,
      officialUrl,
      capturedAt: new Date().toISOString()
    };
  } finally {
    // CDP may be attached to a visible user-login tab. Never close pages that
    // existed before this collection attempt.
    await Promise.all(context.pages().filter(p => !initialPages.has(p)).map(p => p.close().catch(() => {})));
  }
}

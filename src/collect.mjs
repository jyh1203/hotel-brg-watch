import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { buildGoogleHotelsUrl, buildPriceDetailUrl } from "./google-hotels-url.mjs";
import { parseGoogleHotelPrices } from "./parse-google-hotels.mjs";
import { collectMarriottRate } from "./marriott.mjs";

const root = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(await fs.readFile(path.join(root, "config/stays.json"), "utf8"));
const requestedIds = new Set((process.env.STAY_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
const stays = requestedIds.size
  ? config.stays.filter((stay) => requestedIds.has(stay.id))
  : config.stays;
if (!stays.length) throw new Error("STAY_IDS와 일치하는 호텔이 없습니다.");
const historyPath = path.join(root, "data/history.json");
const artifactRoot = path.join(root, "artifacts", new Date().toISOString().slice(0, 10));

async function krwRates() {
  const currencies = [...new Set(stays.map((stay) => stay.booked.currency))];
  const rates = {};
  const dates = {};
  const errors = {};
  await Promise.all(currencies.map(async (currency) => {
    if (currency === "KRW") {
      rates[currency] = 1;
      return;
    }
    try {
      const response = await fetch(`https://api.frankfurter.app/latest?from=${currency}&to=KRW`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`FX HTTP ${response.status}`);
      const data = await response.json();
      rates[currency] = data.rates.KRW;
      dates[currency] = data.date;
    } catch (error) {
      rates[currency] = config.fallbackKrwPerUnit[currency];
      errors[currency] = error.message;
    }
  }));
  return { rates, dates, source: Object.keys(errors).length ? "frankfurter.app+fallback" : "frankfurter.app", errors };
}

async function selectDisplayCurrency(page, currency) {
  const labels = {
    EUR: /^EuroEUR$/,
    JPY: /^Japanese YenJPY$/,
    KRW: /^South Korean WonKRW$/
  };
  const currencyButton = page.locator("button:visible").filter({ hasText: /Currency/ }).first();
  await currencyButton.waitFor({ timeout: 30000 });
  if ((await currencyButton.innerText()).includes(currency)) return;
  await currencyButton.click();
  await page.getByText(labels[currency]).first().click();
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForFunction((targetCurrency) => {
    const text = document.body.innerText.replaceAll("\u200b", "");
    return text.includes(`Currency${targetCurrency}`);
  }, currency, { timeout: 15000 });
}

async function collectStay(browser, stay, fx) {
  const context = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul" });
  const page = await context.newPage();
  const currency = stay.booked.currency;
  const searchUrl = buildGoogleHotelsUrl(stay, currency);
  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByText(stay.hotel, { exact: true }).first().waitFor({ timeout: 30000 });
    const hotelName = page.getByText(stay.hotel, { exact: true }).first();
    const href = await hotelName.evaluate((element) => {
      let current = element;
      while (current && current !== document.body) {
        const priceLink = current.querySelector?.('a[aria-label^="Prices starting"]');
        if (priceLink?.getAttribute("href")) return priceLink.getAttribute("href");
        current = current.parentElement;
      }
      return null;
    });
    const alreadyOnDetail = await page.getByText("Prices", { exact: true }).first().isVisible().catch(() => false);
    if (!href && !alreadyOnDetail) throw new Error("호텔 상세 링크를 찾지 못했습니다.");
    const detailUrl = buildPriceDetailUrl(searchUrl, href ?? page.url());
    await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByText("Prices", { exact: true }).first().waitFor({ timeout: 30000 });
    await selectDisplayCurrency(page, currency);
    await page.waitForFunction((targetCurrency) => {
      const patterns = {
        KRW: /(?:₩|KRW\s?)[\d,]+/i,
        EUR: /(?:€|EUR\s?)[\d,]+/i,
        JPY: /(?:¥|￥|JPY\s?)[\d,]+/i
      };
      const lines = document.body.innerText.split(/\r?\n/);
      const start = lines.findIndex((line) => /Sponsored.*Featured options/i.test(line));
      const end = lines.findIndex((line, index) => index > start && /^All options$/i.test(line.trim()));
      const roomPrices = lines.slice(Math.max(0, start), end > start ? end : lines.length).join("\n");
      return start >= 0 && patterns[targetCurrency].test(roomPrices);
    }, currency, { timeout: 30000 });
    const text = await page.locator("body").innerText();
    const prices = parseGoogleHotelPrices(text, stay, currency);
    const bookedKrw = Math.round(stay.booked.total * fx.rates[stay.booked.currency]);
    const displayedCandidate = prices.exactCandidate ?? prices.freeCancellation ?? prices.lowestProvider;
    if (!displayedCandidate) throw new Error("가격 후보를 찾지 못했습니다.");
    const candidate = prices.exactCandidate ?? prices.freeCancellation;
    const addKrwReference = (rate) => rate ? { ...rate, totalKrw: Math.round(rate.totalAmount * fx.rates[currency]) } : rate;
    return {
      id: stay.id,
      status: "ok",
      hotel: stay.hotel,
      detailUrl,
      bookedKrw,
      bookedAmount: stay.booked.total,
      bookedRoomSubtotal: stay.booked.roomSubtotal,
      bookedCurrency: stay.booked.currency,
      ...prices,
      providers: prices.providers.map(addKrwReference),
      roomRates: prices.roomRates.map(addKrwReference),
      lowestProvider: addKrwReference(prices.lowestProvider),
      freeCancellation: addKrwReference(prices.freeCancellation),
      exactCandidate: addKrwReference(prices.exactCandidate),
      candidateKind: prices.exactCandidate ? "exact" : prices.freeCancellation ? "free-cancel-review" : "headline-review",
      candidateSavingsAmount: candidate ? stay.booked.roomSubtotal - candidate.totalAmount : null,
      candidateSavingsKrw: candidate ? Math.round((stay.booked.roomSubtotal - candidate.totalAmount) * fx.rates[currency]) : null
    };
  } catch (error) {
    await fs.mkdir(artifactRoot, { recursive: true });
    await page.screenshot({ path: path.join(artifactRoot, `${stay.id}.png`), fullPage: true }).catch(() => {});
    return { id: stay.id, status: "error", hotel: stay.hotel, searchUrl, error: error.message };
  } finally {
    await context.close();
  }
}

await fs.mkdir(path.dirname(historyPath), { recursive: true });
const collectMarriott = process.env.PLAYWRIGHT_HEADFUL === "1";
const googleBrowser = await chromium.launch({ headless: true });
const fx = await krwRates();
const results = [];
for (const stay of stays) {
  console.log(`Checking ${stay.hotel}...`);
  let result = await collectStay(googleBrowser, stay, fx);
  if (result.status === "error") {
    console.log(`Retrying ${stay.hotel} after: ${result.error.split("\n")[0]}`);
    result = await collectStay(googleBrowser, stay, fx);
  }
  results.push(result);
}
await googleBrowser.close();

if (collectMarriott) {
  const marriottBrowser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const marriottContext = await marriottBrowser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1365, height: 900 }
  });
  for (let index = 0; index < stays.length; index += 1) {
    const stay = stays[index];
    console.log(`Checking Marriott official rate for ${stay.hotel}...`);
    let marriott = await collectMarriottRate(marriottContext, stay, fx);
    if (marriott.status === "error") {
      console.log(`Retrying Marriott for ${stay.hotel} after: ${marriott.error}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      marriott = await collectMarriottRate(marriottContext, stay, fx);
    }
    results[index].marriott = marriott;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  await marriottContext.close();
  await marriottBrowser.close();
} else {
  for (const result of results) result.marriott = {
      status: "error",
      error: "Marriott 공식가는 PLAYWRIGHT_HEADFUL=1 실행에서 수집됩니다."
  };
}

let history = { schemaVersion: 1, runs: [] };
try { history = JSON.parse(await fs.readFile(historyPath, "utf8")); } catch {}
const run = { capturedAt: new Date().toISOString(), fx, results };
history.runs = [...history.runs, run].slice(-400);
await fs.writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);
console.log(JSON.stringify(run, null, 2));

if (results.every((result) => result.status === "error")) process.exitCode = 2;

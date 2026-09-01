import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { buildGoogleHotelsUrl, buildPriceDetailUrl } from "./google-hotels-url.mjs";
import { parseGoogleHotelPrices } from "./parse-google-hotels.mjs";

const root = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(await fs.readFile(path.join(root, "config/stays.json"), "utf8"));
const historyPath = path.join(root, "data/history.json");
const artifactRoot = path.join(root, "artifacts", new Date().toISOString().slice(0, 10));

async function krwRates() {
  const currencies = [...new Set(config.stays.map((stay) => stay.booked.currency))];
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

async function collectStay(browser, stay, fx) {
  const context = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul" });
  const page = await context.newPage();
  const searchUrl = buildGoogleHotelsUrl(stay, config.currency);
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
    await page.waitForFunction(() => /(?:₩|KRW\s?)[\d,]+/i.test(document.body.innerText), null, { timeout: 30000 });
    const text = await page.locator("body").innerText();
    const prices = parseGoogleHotelPrices(text, stay);
    const bookedKrw = Math.round(stay.booked.total * fx.rates[stay.booked.currency]);
    const displayedCandidate = prices.exactCandidate ?? prices.freeCancellation ?? prices.lowestProvider;
    if (!displayedCandidate) throw new Error("가격 후보를 찾지 못했습니다.");
    const candidate = prices.exactCandidate ?? prices.freeCancellation;
    return {
      id: stay.id,
      status: "ok",
      hotel: stay.hotel,
      detailUrl,
      bookedKrw,
      bookedAmount: stay.booked.total,
      bookedCurrency: stay.booked.currency,
      ...prices,
      candidateKind: prices.exactCandidate ? "exact" : prices.freeCancellation ? "free-cancel-review" : "headline-review",
      candidateSavingsKrw: candidate ? bookedKrw - candidate.totalKrw : null
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
const browser = await chromium.launch({ headless: true });
const fx = await krwRates();
const results = [];
for (const stay of config.stays) {
  console.log(`Checking ${stay.hotel}...`);
  let result = await collectStay(browser, stay, fx);
  if (result.status === "error") {
    console.log(`Retrying ${stay.hotel} after: ${result.error.split("\n")[0]}`);
    result = await collectStay(browser, stay, fx);
  }
  results.push(result);
}
await browser.close();

let history = { schemaVersion: 1, runs: [] };
try { history = JSON.parse(await fs.readFile(historyPath, "utf8")); } catch {}
const run = { capturedAt: new Date().toISOString(), fx, results };
history.runs = [...history.runs, run].slice(-400);
await fs.writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);
console.log(JSON.stringify(run, null, 2));

if (results.every((result) => result.status === "error")) process.exitCode = 2;

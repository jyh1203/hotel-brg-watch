import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import fs from "node:fs";

const config = JSON.parse(fs.readFileSync(new URL("../config/stays.json", import.meta.url), "utf8"));
const dashboardData = JSON.parse(fs.readFileSync(new URL("../site/data.json", import.meta.url), "utf8"));

test("dashboard renders every configured stay with currency charts", async () => {
  const server = spawn(process.execPath, ["src/server.mjs"], { stdio: "ignore" });
  const browser = await chromium.launch({ headless: true });
  try {
    let response;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      response = await fetch("http://127.0.0.1:4173/").catch(() => null);
      if (response?.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(response?.status, 200);

    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
    assert.deepEqual(errors, []);
    assert.equal(await page.locator("#cards .card").count(), config.stays.length);
    assert.equal(await page.locator("#cards .chart").count(), config.stays.length);
    assert.match(await page.locator("#summary").innerText(), new RegExp(`\\d/${config.stays.length}\\s*결과 표시`));
    assert.match(await page.locator("#cards").innerText(), /(오늘 Google 세금 포함 전체 총액|최근 Google 세금 포함 전체 총액)/);
    assert.match(await page.locator("#cards").innerText(), /Marriott 공식 객실료\(세금 제외\)/);
    assert.equal(await page.locator(".source-links a").count(), config.stays.length * 2);
    const cardsText = await page.locator("#cards").innerText();
    assert.equal(await page.locator(".comparison-basis").count(), config.stays.length);
    assert.equal(await page.locator(".brg-callout").count(), config.stays.length);
    assert.ok(await page.locator(".rate-drop-alert").count() >= 1);
    assert.match(cardsText, /내 예약 총액\s*세금 포함/);
    assert.match(cardsText, /BRG 비교 기준 객실료.*세금 제외/);
    assert.match(cardsText, /Marriott 공식 객실료.*세금 제외/);
    assert.match(cardsText, /Google은 세금 포함 추이, 예약·Marriott는 세금 제외 비교선/);
    assert.match(cardsText, /(참고 추정 세전|세전 금액 확인 필요)/);
    assert.equal(await page.locator('input[name="googleTotal"]').count(), config.stays.length);
    assert.equal(await page.locator('input[name="googleTaxes"]').count(), config.stays.length);
    assert.match(await page.locator("#summary").innerText(), /Google 세전 금액 확인/);
    assert.match(await page.locator("#summary").innerText(), new RegExp(`0/${config.stays.length}\\s*Google 세전 금액 확인`));
    assert.match(cardsText, /BRG 신청 가능/);
    assert.match(await page.locator("#summary").innerText(), /Marriott 공식 객실료 인하/);
    for (const currency of new Set(config.stays.map((stay) => stay.booked.currency))) {
      assert.match(cardsText, new RegExp(`${currency} 기준`));
    }
    assert.match(await page.locator("#cards").innerText(), /확정/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);

    const madrid = config.stays.find((stay) => stay.id === "madrid-carlton");
    const capturedAt = new Date().toISOString();
    const synthetic = structuredClone(dashboardData);
    synthetic.runs.push({
      capturedAt,
      fx: { rates: { EUR: 1539.06 } },
      results: [{
        id: madrid.id,
        status: "ok",
        hotel: madrid.hotel,
        checkIn: madrid.checkIn,
        checkOut: madrid.checkOut,
        adults: madrid.adults,
        nights: 4,
        dateConfirmed: true,
        candidateKind: "exact",
        exactCandidate: {
          currency: "EUR", totalAmount: 640, nightlyAmount: 160, amountBasis: "pre-tax",
          context: "Standard King Room · 1 king bed · Free cancellation until Apr 2",
          freeCancellation: true, cancellationDeadline: "2027-04-02", provider: "Booking.com",
          publicRate: true, availabilityVerified: false, estimatedFromNightly: true
        },
        marriott: {
          status: "ok", rateName: "Member Flexible Rate", currency: "EUR", totalAmount: 760,
          amountBasis: "pre-tax", prepaid: false, cancellation: "Free cancellation before or on Apr 02, 2027",
          sourceUrl: "https://www.marriott.com/", capturedAt
        }
      }]
    });
    await page.route("**/data.json*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(synthetic) }));
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator(".google-opportunity").count(), 1);
    assert.equal(await page.locator(".google-opportunity.price-pass").count(), 1);
    assert.match(await page.locator(".google-opportunity").innerText(), /Google 검증 후보가 Marriott 공식 현행가보다 낮습니다/);
    assert.match(await page.locator(".google-opportunity").innerText(), /내 예약 BRG 가격 상한 .* 이하 · 가격 차이 충족/);
    assert.match(await page.locator(".google-opportunity").innerText(), /결제 직전 실제 예약 가능/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
});

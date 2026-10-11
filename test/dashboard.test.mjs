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
    assert.match(cardsText, /Google · 마지막 시도/);
    assert.match(cardsText, /Marriott · 마지막 시도/);
    assert.match(cardsText, /마지막 가격 수집/);
    assert.equal(await page.locator(".comparison-basis").count(), config.stays.length);
    assert.equal(await page.locator("#brg-guide").count(), 1);
    assert.equal(await page.locator("#brg-guide .info-trigger").count(), 1);
    assert.equal(await page.locator("#brg-guide [role=tooltip]").count(), 1);
    await page.locator("#brg-guide .info-trigger").focus();
    assert.equal(await page.locator("#brg-guide [role=tooltip]").isVisible(), true);
    assert.equal(await page.locator(".brg-threshold").count(), config.stays.length);
    assert.equal(await page.locator(".brg-callout").count(), 0);
    assert.ok(await page.locator(".rate-drop-alert").count() >= 1);
    assert.match(cardsText, /내 예약 객실료\s*세금 제외/);
    assert.match(cardsText, /Google 확인 객실료\s*세금 제외/);
    assert.match(cardsText, /세전 확인 필요/);
    assert.match(cardsText, /BRG 비교 기준 객실료.*세금 제외/);
    assert.match(cardsText, /Marriott 공식 객실료.*세금 제외/);
    assert.match(cardsText, /그래프는 모두 세금 제외 · Google 확인 세전 기록만 표시/);
    assert.doesNotMatch(cardsText, /참고 추정 세전/);
    assert.equal(await page.locator('input[name="googleTotal"]').count(), config.stays.length);
    assert.equal(await page.locator('input[name="googleTaxes"]').count(), config.stays.length);
    assert.match(await page.locator("#summary").innerText(), /Google 세전 금액 확인/);
    assert.match(await page.locator("#summary").innerText(), new RegExp(`0/${config.stays.length}\\s*Google 세전 금액 확인`));
    assert.match(await page.locator("#brg-guide").innerText(), /OTA 세전 총액.*1% 초과 낮아야/);
    assert.match(cardsText, /BRG 신청 상한/);
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
        occupancyConfirmed: true,
        searchEvidence: {checkIn:madrid.checkIn,checkOut:madrid.checkOut,adults:madrid.adults,children:0},
        providers: ['Booking.com','Agoda','Expedia'].map(provider => ({provider,currency:'EUR',totalAmount:600,amountBasis:'tax-included',estimatedFromNightly:false,publicRate:true})),
        exactCandidate: {
          currency: "EUR", totalAmount: 640, nightlyAmount: 160, amountBasis: "pre-tax",
          context: "Standard King Room · 1 king bed · Free cancellation until Apr 2",
          freeCancellation: true, cancellationDeadline: "2027-04-02", provider: "Booking.com",
          publicRate: true, availabilityVerified: false, estimatedFromNightly: false
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
    assert.match(await page.locator('.google-price').first().innerText(), /Google 확인 객실료\s*세금 제외\s*€640/);
    assert.equal(await page.locator(".google-opportunity").count(), 1);
    assert.equal(await page.locator(".google-opportunity.price-pass").count(), 1);
    assert.match(await page.locator(".google-opportunity").innerText(), /Google 검증 후보가 Marriott 공식 현행가보다 낮습니다/);
    assert.match(await page.locator(".google-opportunity").innerText(), /내 예약 BRG 가격 상한 .* 이하 · 가격 차이 충족/);
    assert.match(await page.locator(".google-opportunity").innerText(), /결제 직전 실제 예약 가능/);
    assert.equal(await page.locator('.ota-review').first().locator('.ota-priority').count(), 3);
    assert.match(await page.locator('.ota-review').first().innerText(), /우선 확인은 BRG 승인 확률이나 확정 판정이 아닙니다/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await page.locator("#brg-guide").scrollIntoViewIfNeeded();
    await page.locator("#brg-guide .info-trigger").focus();
    const tooltipBox = await page.locator("#brg-guide [role=tooltip]").boundingBox();
    assert.ok(tooltipBox && tooltipBox.x >= 0 && tooltipBox.x + tooltipBox.width <= 390);

    const candidate = synthetic.runs.at(-1).results[0].exactCandidate;
    Object.assign(candidate, { totalAmount: 226, nightlyAmount: 56.5, amountBasis: "tax-included" });
    await page.reload({ waitUntil: "networkidle" });
    const form = page.locator('.brg-form[data-id="madrid-carlton"]');
    const openForm = () => form.evaluate((element) => { element.closest("details").open = true; });
    await openForm();
    await form.locator('[name="official"]').fill("760");
    await form.locator('[name="googleTotal"]').fill("226");
    await form.locator('[name="googleTaxes"]').fill("20");
    await form.locator('[name="propertyCharges"]').fill("6");
    await form.locator('[name="propertyIncluded"]').selectOption("yes");
    await form.locator('button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('.google-price')?.innerText.includes('€200'));
    assert.match(await page.locator('.google-price').first().innerText(), /€200/);

    Object.assign(candidate, { totalAmount: 220, nightlyAmount: 55 });
    await page.reload({ waitUntil: "networkidle" });
    await openForm();
    await form.locator('[name="googleTotal"]').fill("220");
    await form.locator('[name="propertyIncluded"]').selectOption("no");
    await form.locator('button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('.google-price')?.innerText.includes('€200'));
    assert.match(await page.locator('.google-price').first().innerText(), /€200/);
    assert.doesNotMatch(await page.locator('.google-price').first().innerText(), /€194/);
    await openForm();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await form.locator('[name="propertyIncluded"]').selectOption("unknown");
    await form.locator('button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('.google-price')?.innerText.includes('세전 확인 필요'));
    assert.match(await page.locator('.google-price').first().innerText(), /세전 확인 필요/);
    assert.equal(await page.locator(".google-opportunity").count(), 0);
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
});

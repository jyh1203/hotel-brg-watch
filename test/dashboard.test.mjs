import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import fs from "node:fs";

const config = JSON.parse(fs.readFileSync(new URL("../config/stays.json", import.meta.url), "utf8"));

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
    assert.match(await page.locator("#cards").innerText(), /(오늘 Google 표시가 합계|최근 Google 표시가 합계)/);
    assert.match(await page.locator("#cards").innerText(), /Marriott 공식 객실료\(세금 제외\)/);
    assert.equal(await page.locator(".source-links a").count(), config.stays.length * 2);
    const cardsText = await page.locator("#cards").innerText();
    assert.equal(await page.locator(".comparison-basis").count(), config.stays.length);
    assert.equal(await page.locator(".brg-callout").count(), config.stays.length);
    assert.ok(await page.locator(".rate-drop-alert").count() >= 1);
    assert.match(cardsText, /내 예약 총액\s*세금 포함/);
    assert.match(cardsText, /BRG 비교 기준 객실료.*세금 제외/);
    assert.match(cardsText, /Marriott 공식 객실료.*세금 제외/);
    assert.match(cardsText, /세금 제외 예약 객실료 기준선/);
    assert.match(cardsText, /BRG 신청 가능/);
    assert.match(await page.locator("#summary").innerText(), /Marriott 공식 객실료 인하/);
    for (const currency of new Set(config.stays.map((stay) => stay.booked.currency))) {
      assert.match(cardsText, new RegExp(`${currency} 기준`));
    }
    assert.match(await page.locator("#cards").innerText(), /확정/);
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
});

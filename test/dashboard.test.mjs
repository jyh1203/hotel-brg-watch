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
    assert.match(await page.locator("#cards").innerText(), /(오늘 Google 예상 총액|최근 Google 예상 총액)/);
    assert.match(await page.locator("#cards").innerText(), /Marriott 예상 총액/);
    assert.equal(await page.locator(".source-links a").count(), config.stays.length * 2);
    assert.match(await page.locator("#cards").innerText(), /EUR 기준/);
    assert.match(await page.locator("#cards").innerText(), /JPY 기준/);
    assert.match(await page.locator("#cards").innerText(), /BRG 신청 중/);
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
});

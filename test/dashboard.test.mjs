import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

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
    assert.equal(await page.locator("#cards .card").count(), 5);
    assert.equal(await page.locator("#cards .chart").count(), 5);
    assert.match(await page.locator("#summary").innerText(), /5\/5\s*결과 표시/);
    assert.match(await page.locator("#cards").innerText(), /(오늘 후보가|최근 후보가)/);
    assert.match(await page.locator("#cards").innerText(), /EUR 기준/);
    assert.match(await page.locator("#cards").innerText(), /JPY 기준/);
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
});

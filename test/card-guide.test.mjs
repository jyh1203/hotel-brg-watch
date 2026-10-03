import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

test("card guide renders, filters, persists status, and has no horizontal overflow", async () => {
  const server = spawn(process.execPath, ["src/server.mjs"], { stdio: "ignore" });
  const browser = await chromium.launch({ headless: true });
  try {
    let response;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      response = await fetch("http://127.0.0.1:4173/card-guide.html").catch(() => null);
      if (response?.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(response?.status, 200);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:4173/card-guide.html", { waitUntil: "networkidle" });
    assert.deepEqual(errors, []);
    assert.ok(await page.locator("#cards .card").count() >= 20);
    await page.locator("#search").fill("현대백화점");
    assert.equal(await page.locator("#cards .card").count(), 1);
    assert.match(await page.locator("#cards").innerText(), /HI-POINT/);
    await page.locator("#search").fill("주차");
    assert.match(await page.locator("#cards").innerText(), /RPM Platinum#/);
    await page.locator("#search").fill("");
    await page.locator("#woori-done").check();
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("#woori-done").isChecked(), true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `390px 화면에 가로 오버플로가 있습니다: ${overflow}px`);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.reload({ waitUntil: "networkidle" });
    const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(desktopOverflow <= 1, `1440px 화면에 가로 오버플로가 있습니다: ${desktopOverflow}px`);
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../site/trip_gunsan.html", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../site/index.html", import.meta.url), "utf8");

test("Gunsan itinerary follows the required day order and anchors", () => {
  const dayOne = html.indexOf('id="d9"');
  const dayTwo = html.indexOf('id="d10"');
  assert.ok(dayOne >= 0 && dayTwo > dayOne);
  for (const expected of [
    "군산짬뽕페스티벌 1차",
    "군산짬뽕페스티벌 2차",
    "경암동 철길마을",
    "동양어묵",
    "3대째 어묵",
    "흑화양조",
    "군산 카무인텔",
    "군산근대역사박물관",
    "초원사진관",
    "신흥동 일본식가옥",
  ]) assert.match(html, new RegExp(expected));
  const dayOneHtml = html.slice(dayOne, dayTwo);
  const dayOneTimeline = dayOneHtml.slice(dayOneHtml.indexOf('<div class="timeline">'));
  assert.ok(dayOneTimeline.indexOf("경암동 철길마을") < dayOneTimeline.indexOf("동양어묵"));
  assert.ok(dayOneTimeline.indexOf("동양어묵") < dayOneTimeline.indexOf("군산짬뽕페스티벌 1차"));
});

test("Gunsan itinerary corrects the fish-cake stop and excludes the mistaken hotteok stop", () => {
  assert.match(html, /50년 전통·3대째 제조/);
  assert.match(html, /중동호떡은 일정에서 제외했습니다/);
  assert.doesNotMatch(html, /중동호떡 지도|중동호떡 포장/);
  assert.match(html, /dongyangfood\.net/);
});

test("Gunsan itinerary publishes actionable Naver map links and official sources", () => {
  const mapLinks = html.match(/https:\/\/map\.naver\.com\/p\/search\//g) ?? [];
  assert.ok(mapLinks.length >= 10, `expected at least 10 Naver map links, got ${mapLinks.length}`);
  assert.match(html, /https:\/\/jjambbong\.kr/);
  assert.match(html, /gunsan\.go\.kr\/tour\/m2101\/view\/5235377/);
});

test("Gunsan itinerary keeps private values out and is linked from the BRG dashboard", () => {
  assert.doesNotMatch(html, /예약번호\s*[:：]\s*[A-Z0-9-]+|확인번호\s*[:：]\s*[A-Z0-9-]+|차량번호\s*[:：]\s*\S+|카드번호\s*[:：]\s*\S+/);
  assert.match(html, /공개 페이지에는 숙소 예약번호·차량번호·자택 상세 주소를 포함하지 않습니다/);
  assert.match(index, /href="trip_gunsan\.html">군산 일정표/);
});

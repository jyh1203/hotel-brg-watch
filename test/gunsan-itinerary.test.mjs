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
    "젤라또 노베오",
    "음미당",
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
  assert.ok(mapLinks.length >= 25, `expected at least 25 Naver map links, got ${mapLinks.length}`);
  assert.match(html, /https:\/\/jjambbong\.kr/);
  assert.match(html, /gunsan\.go\.kr\/tour\/m2101\/view\/5235377/);
});

test("Gunsan itinerary uses the confirmed lodging hours and parking plan", () => {
  assert.match(html, /체크인 10\/9 18:00, 체크아웃 10\/10 13:00/);
  assert.match(html, /정식 체크인은 18:00부터/);
  assert.match(html, /제1주차장\(경포1길 35\)/);
  assert.match(html, /제5주차장\(진포로 224\)/);
  assert.match(html, /동양어묵: 건물 옆 주차공간/);
  assert.match(html, /숙소·짬뽕거리·근대문화거리: 숙소에 사전 주차 후 도보/);
});

test("Gunsan itinerary includes daily cafe anchors and every supplied food alternative", () => {
  assert.match(html, /DAY 1 카페·필수 디저트/);
  assert.match(html, /DAY 2 카페·브런치/);
  for (const expected of [
    "시골식당",
    "엄마밥상",
    "명궁칼국수",
    "황해짬뽕집",
    "유락",
    "큰집 평양온반",
    "훈이네",
    "고향옛칼국수",
    "연화구",
    "파라디소90",
    "압강옥",
    "월명동휘겔리",
    "럭키크라운",
    "빵굽는오남매",
    "홍윤베이커리",
  ]) assert.match(html, new RegExp(expected));
});

test("Gunsan itinerary keeps the three famous jjambbong shops outside the festival booths", () => {
  assert.match(html, /축제 밖 군산 3대 짬뽕/);
  assert.match(html, /축제 참가 부스로 전제하지 않고 별도 매장 방문 후보/);
  for (const expected of ["지린성", "복성루", "빈해원"]) {
    assert.match(html, new RegExp(expected));
  }
  assert.match(html, /한글날인 10월 9일은 제외/);
  assert.match(html, /10월 10일 오전 후보/);
});

test("Gunsan itinerary keeps private values out and is linked from the BRG dashboard", () => {
  assert.doesNotMatch(html, /예약번호\s*[:：]\s*[A-Z0-9-]+|확인번호\s*[:：]\s*[A-Z0-9-]+|차량번호\s*[:：]\s*\S+|카드번호\s*[:：]\s*\S+/);
  assert.doesNotMatch(html, /26100610014089YE1|0504-4081-7281/);
  assert.match(html, /공개 페이지에는 숙소 예약번호·차량번호·자택 상세 주소를 포함하지 않습니다/);
  assert.match(index, /href="trip_gunsan\.html">군산 일정표/);
});

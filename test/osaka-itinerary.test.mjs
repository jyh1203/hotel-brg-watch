import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../site/trip_osaka.html", import.meta.url), "utf8");

test("Osaka itinerary follows the confirmed day order and travel details", () => {
  const anchors = ["d17", "d18", "d19", "d20", "d21"];
  const positions = anchors.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(html, /T1 1층 5번 승차장/);
  assert.match(html, /고베 누노비키 허브원/);
  assert.match(html, /메리켄파크·고베 포트타워/);
  assert.match(html, /오사카성 YATAI 페스티벌/);
  assert.match(html, /텐진바시스지 상점가/);
  assert.match(html, /나카자키초 골목/);
  assert.match(html, /우메다 스카이빌딩 공중정원/);
  assert.doesNotMatch(html, /요코오 다다노리|국립국제미술관|미술관/);
  assert.match(html, /인천 중구 공항문화로 127 \(운서동 2955-74\)/);
});

test("Osaka itinerary retains the original confirmed transport, food, and lodging plan", () => {
  for (const expected of [
    "ZE611 인천 T1 → 간사이 T1",
    "ZE614 간사이 T1 → 인천 T1",
    "킷사 선샤인",
    "타츠스시 마구로 잇테츠 센니치마에점",
    "하나마루켄 라멘",
    "스테이크랜드 고베관",
    "고베 니시무라 커피 나카야마테 본점",
    "난킨마치 산책·간식",
    "551 간사이공항점",
    "인스파이어 체크인",
  ]) {
    assert.match(html, new RegExp(expected));
  }
});

test("Osaka itinerary keeps private confirmation numbers out of the public page", () => {
  assert.doesNotMatch(html, /72412419/);
  assert.match(html, /공개 페이지에는 예약 확인번호를 표시하지 않습니다/);
});

test("Osaka itinerary uses verified airport guidance", () => {
  assert.match(html, /06:15부터 주차하는 일정이 아니라 터미널 도착 목표/);
  assert.match(html, /551 간사이공항점은 공식상 T1 2층 국내선 플로어/);
  assert.doesNotMatch(html, /551 간사이공항점은 공식상 T1 4층/);
});

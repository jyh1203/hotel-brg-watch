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
  assert.match(html, /Curators in Panic 2/);
  assert.match(html, /국립국제미술관 《나\/행위》/);
  assert.match(html, /인천 중구 공항문화로 127 \(운서동 2955-74\)/);
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

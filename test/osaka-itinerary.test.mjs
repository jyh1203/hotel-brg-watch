import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../site/trip_osaka.html", import.meta.url), "utf8");
const expenseHtml = fs.readFileSync(new URL("../site/trip_osaka_expenses.html", import.meta.url), "utf8");

test("Osaka itinerary follows the confirmed day order and travel details", () => {
  const anchors = ["d17", "d18", "d19", "d20", "d21"];
  const positions = anchors.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(html, /T1 1층 5번 승차장/);
  assert.match(html, /DAY 2 완료/);
  assert.match(html, /DAY 3 완료/);
  assert.match(html, /DAY 4 완료/);
  assert.match(html, /마리오카트: 쿠파의 도전장/);
  assert.match(html, /카자미도리노야카타/);
  assert.match(html, /메리켄파크 불꽃축제/);
  assert.match(html, /오사카성 앞 YATAI/);
  assert.match(html, /LUCUA 1100 칼디 커피팜/);
  assert.match(html, /OWL LIQUOR/);
  assert.doesNotMatch(html, /고베 누노비키 허브원|頃末商店 위스키숍|리커마운틴 우메다점/);
  assert.doesNotMatch(html, /텐진바시스지 상점가|나카자키초 골목|우메다 스카이빌딩 공중정원/);
  assert.doesNotMatch(html, /야마자키 증류소|LIQUOR MUSEUM|킹그램 리커 니시텐마점/);
  assert.doesNotMatch(html, /요코오 다다노리|국립국제미술관|미술관/);
  assert.match(html, /인천 중구 공항문화로 127 \(운서동 2955-74\)/);
});

test("Osaka itinerary retains confirmed transport and lodging while recording the actual completed stops", () => {
  for (const expected of [
    "ZE611 인천 T1 → 간사이 T1",
    "ZE614 간사이 T1 → 인천 T1",
    "타치스시 마구로 잇테츠 센니치마에점",
    "하나마루켄 난바 호젠지점",
    "MONDIAL KAFFEE 328 NY3",
    "오렌지스트리트 · 스투시 오사카",
    "스테이크랜드 고베관",
    "고베 니시무라 커피 나카야마테 본점",
    "이쿠타신사",
    "하버랜드 모자이크몰 갓덴스시",
    "이치란 라멘 우메다점",
    "Standard Products 우메다점",
    "LINKS UMEDA GU",
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
  assert.match(html, /06:30 공식 발렛 예약/);
  assert.match(html, /단기주차장 B1 A구역 15번/);
  assert.match(html, /단기주차장 B3 A구역 공식 인도장/);
  assert.match(html, /신한 Marriott Bonvoy 카드로 발렛 서비스 요금 무료/);
  assert.match(html, /전기차는 저공해 1종으로 50% 자동감면 대상/);
  assert.doesNotMatch(html, /장기주차 차량 회수|장기주차 위치 기록/);
  assert.match(html, /551 간사이공항점은 공식상 T1 2층 국내선 플로어/);
  assert.doesNotMatch(html, /551 간사이공항점은 공식상 T1 4층/);
});

test("Osaka itinerary records the KIX baggage-claim cash withdrawal stop", () => {
  assert.match(html, /수하물 수취장 ATM에서 엔화 인출/);
  assert.match(html, /4번·5번 수하물 벨트 사이 1대/);
  assert.match(html, /6번 수하물 벨트 옆 1대/);
  assert.match(html, /핫핑크색 ATM 2대/);
  assert.match(html, /kansai-airport\.or\.jp\/ko\/service\/money_insurance\/atm/);
  assert.ok(
    html.indexOf("입국심사·수하물 수령") < html.indexOf("수하물 수취장 ATM에서 엔화 인출") &&
      html.indexOf("수하물 수취장 ATM에서 엔화 인출") < html.indexOf("간사이공항 → 호텔 한큐 레스파이어 오사카"),
  );
});

test("Osaka itinerary records the completed day-one route without publishing expense details", () => {
  for (const expected of [
    "DAY 1 완료",
    "실제 방문 순서대로 정리한 DAY 1 기록",
    "타치스시 마구로 잇테츠 센니치마에점",
    "신사이바시 PARCO 굿즈숍",
    "디즈니 스토어·지브리·캡콤",
    "MONDIAL KAFFEE 328 NY3",
    "モンディアルカフェ 328 NY3",
    "立ち寿司 まぐろ一徹 千日前",
    "스프링뱅크",
    "오렌지스트리트 · 스투시",
    "Supreme·BAPE·Carhartt 구경",
    "산리오 팝업",
    "신사이바시 아케이드 갓챠·피규어숍",
    "갓챠를 6회",
    "숙소 근처 패밀리마트",
  ]) {
    assert.match(html, new RegExp(expected));
  }
  assert.doesNotMatch(html, /428\.04|53,512|85,741|46,661|34,748|7,899|60,525/);
  assert.match(html, /오사카 여행 가계부/);
});

test("Osaka itinerary provides inline Google Maps links for actual and planned stops", () => {
  for (const expected of [
    "OWL 지도",
    "타치스시 지도",
    "하나마루켄 지도",
    "PARCO 지도",
    "카페 지도",
    "스투시 지도",
    "패밀리마트 지도",
    "스테이크랜드 지도",
    "이쿠타신사 지도",
    "스쿨버스커피 지도",
    "갓덴스시 지도",
    "이치란 지도",
    "돈키호테 지도",
    "GU 지도",
    "칼디 지도",
    "카마타케 지도",
    "숙소 지도",
    "USJ 지도",
    "YATAI 행사장 지도",
    "인스파이어 지도",
  ]) {
    assert.match(html, new RegExp(expected));
  }
  const googleMapLinks = html.match(/https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=/g) ?? [];
  assert.ok(googleMapLinks.length >= 25, `expected at least 25 Google Maps links, got ${googleMapLinks.length}`);
});

test("Osaka expense page publishes the day-one through day-four ledger without private identifiers", () => {
  assert.match(html, /href="trip_osaka_expenses\.html">오사카 여행 가계부/);
  for (const expected of [
    "DAY 1 원화 승인",
    "₩241,376",
    "¥8,414",
    "¥12,414",
    "¥313",
    "¥7,899",
    "갓챠 ¥400 × 6회",
    "이스타항공 왕복 항공권",
    "₩488,400",
    "최초 ₩450,000 \\+ 출발일 하루 당김 추가금 ₩38,400",
    "DAY 2 거래 내역",
    "¥11,416",
    "DAY 3 거래 내역",
    "¥17,989",
    "DAY 4 거래 내역",
    "₩350,458",
    "¥48,730",
    "매트 주술회전 피규어 ¥2,200 포함",
    "결제수단 미기록",
    "여행 중 임시 공개",
    "2026-09-22 로컬 전환 예정",
  ]) {
    assert.match(expenseHtml, new RegExp(expected));
  }
  assert.doesNotMatch(expenseHtml, /72412419|카드번호|예약번호/);
});

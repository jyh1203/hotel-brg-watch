# Hotel BRG Watch

2026년 오사카 및 2027년 스페인·프랑스 여행의 Marriott 예약가를 기준으로 Google Hotels 후보가와 Marriott 공식 공개가를 매일 확인하는 개인용 대시보드입니다.

## 무엇을 보여주나

- 전일 대비 가격 변화
- 호텔별 `내 예약 / Google 후보 / Marriott 공식` 가격 그래프(최대 60일)
- 기존 예약가 대비 잠재 절감액
- 전체 헤드라인 최저가
- 무료취소 후보가
- 객실명과 무료취소 문구가 모두 맞는 자동 후보
- 실제 Google Hotels 가격표와 Marriott 공식 예약 페이지 링크

`싼 가격 = BRG 가능`으로 처리하지 않습니다. 객실·침대·인원·날짜·무료취소·결제 방식이 동일해야 하며 최종 신청 전 사람이 원문을 확인해야 합니다.

## 대상 예약

- Four Points Flex by Sheraton Osaka Umeda, 2026-09-17~21
- AC Hotel Carlton Madrid, 2027-04-03~07
- Hotel Ercilla de Bilbao, 2027-04-07~10
- Moxy Bordeaux, 2027-04-10~12
- Four Points Barcelona Diagonal, 2027-04-13~16
- Four Points Barcelona Diagonal 2박 비교안, 2027-04-13~15

공개 저장소이므로 호텔 확인번호는 기준 데이터에 저장하지 않습니다.

예약 조건과 기준가는 [`config/stays.json`](config/stays.json)에서 수정합니다.

## 로컬 실행

```bash
npm install
npx playwright install chromium
npm test
npm run collect
# Marriott 공식가까지 수집하려면 Linux에서:
xvfb-run -a npm run collect:full
npm run build
npm run dev
```

브라우저에서 <http://localhost:4173>을 엽니다.

## 매일 자동 실행

GitHub Actions가 매일 한국시간 00:30에 가격을 수집하고 `data/history.json`에 기록한 뒤 GitHub Pages를 갱신합니다. 저장소의 **Settings → Pages → Source**를 **GitHub Actions**로 설정해야 합니다.

실행 흐름은 다음과 같습니다.

1. GitHub Actions가 매일 00:30 KST에 저장소를 체크아웃합니다.
2. Node.js와 Playwright Chromium을 설치합니다.
3. `config/stays.json`에서 호텔·숙박일·성인 수·기준 예약가·객실 조건을 읽습니다.
4. Frankfurter API에서 EUR/JPY→KRW 환율을 받아 원화 참고값을 만듭니다. 가격 판단 기준은 예약 통화입니다.
5. 각 호텔을 Google Hotels에서 실제 날짜와 성인 2명 조건으로 순차 검색하며, 오사카는 JPY·유럽은 EUR로 조회합니다.
6. 헤드라인 최저가, 무료취소 요금, 객실명·침대 패턴까지 맞는 Google 요금을 분리합니다. 가격표가 비면 한 번 재시도합니다.
7. Xvfb 가상 화면의 실제 브라우저로 Marriott 공식 예약 페이지를 열고 `View Rates`를 펼쳐 동일 객실의 회원 변경 가능·무료취소 요금만 읽습니다. 선불·비환불 요금은 제외하며, 차단 또는 품절이면 오류를 저장하고 직전 유효값을 유지합니다.
8. Google 상세 가격표 링크와 Marriott 공식 예약 링크를 결과에 함께 저장합니다.
9. 결과와 수집 시각을 `data/history.json`에 최대 400회분 저장합니다.
10. `site/data.json`을 만들고 정적 파일을 GitHub Pages에 배포합니다.
11. 사이트는 예약 통화 기준으로 예약 총액을 수평선, Google 후보가와 Marriott 공식가를 날짜별 선으로 그립니다. 오늘 수집이 실패하면 최근 유효 결과와 그 시각을 표시합니다.

Actions의 `workflow_dispatch`를 사용하면 GitHub의 **Actions → Daily hotel price check → Run workflow**에서 수동 실행할 수도 있습니다.

Google이 GitHub Actions 트래픽을 차단하면 해당 호텔은 오류로 남습니다. 이 경우 로컬에서 `npm run collect`를 실행하면 이력을 계속 추가할 수 있습니다.

## BRG 주의

- Marriott 공식 예약 후 24시간 안에 신청해야 합니다.
- 공개된 타사 요금이어야 합니다.
- 앱 전용·로그인 전용·비환불·패키지 요금은 기존 예약 조건과 다르면 제외됩니다.
- Google Hotels의 최저가는 객실 조건이 생략될 수 있어 `수동 확인` 표시는 신청 근거로 사용하면 안 됩니다.
- Marriott 수집값은 로그인하지 않은 공개 최저 일반요금이며 기본 화면상 세금·요금 제외 금액입니다. 회원가·세금 포함 최종 총액·무료취소 조건은 링크에서 재확인하세요.

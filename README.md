# Hotel BRG Watch

## OTA 우선 확인 (2026-10-11)

Booking.com·Agoda·Expedia는 Google 가격 목록에서 실제 관측한 전체 숙박 표시가를 별도로 보여 준다. 미관측 판매처는 가격 미확인으로 남긴다. 실제 날짜·인원 확인, 같은 통화, 24시간 이내 수집, 전체 숙박 총액과 공개 요금이 확인될 때 세금 포함 총액도 예약 또는 최신 Marriott 객실료보다 낮으면 `우선 확인`으로 표시한다. 이는 객실료의 상한을 이용한 선별이며, 세전 검증 값·그래프·BRG 적격 판정에는 들어가지 않는다. 현재 판매처 결제화면 자동 수집은 미구현이다.

2026년 오사카 및 2027년 스페인·프랑스 여행의 Marriott 예약가를 기준으로 Google Hotels 후보가와 Marriott 공식 공개가를 매일 확인하는 개인용 대시보드입니다.

- BRG 대시보드: <https://jyh1203.github.io/hotel-brg-watch/>
- 스페인·프랑스 일정표: <https://jyh1203.github.io/hotel-brg-watch/trip.html>
- 오사카 일정표: <https://jyh1203.github.io/hotel-brg-watch/trip_osaka.html>

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

공개 저장소이므로 호텔 확인번호는 기준 데이터에 저장하지 않습니다.

예약 조건과 기준가는 [`config/stays.json`](config/stays.json)에서 수정합니다.

## 로컬 실행

```bash
npm install
npx playwright install chromium
npm test
npm run collect
# Marriott 공식가까지 수집하려면 Linux에서:
MARRIOTT_BROWSER_CHANNEL=chrome xvfb-run -a npm run collect:full
npm run build
npm run dev
```

브라우저에서 <http://localhost:4173>을 엽니다.

### Marriott 로그인 상태로 수집

Marriott 요금 목록이 실행 환경에서 차단되면, 사용자가 관리하는 로컬 PC에서 로그인 상태를 재사용할 수 있습니다. 비밀번호를 코드나 GitHub에 저장하지 않습니다.

```bash
npm run auth:marriott
MARRIOTT_AUTH_STATE=.auth/marriott.json npm run collect:full
npm run build
```

`npm run auth:marriott`가 띄운 공식 Marriott 창에서 직접 로그인한 뒤 터미널에서 Enter를 누릅니다. 저장된 `.auth/marriott.json`은 `.gitignore`로 제외됩니다. 세션이 만료되면 같은 절차로 다시 저장합니다.

storage state만으로 로그인이 유지되지 않으면 일반 Chrome 프로필 대신 Marriott 전용 프로필을 사용합니다. 동일 프로필을 사용하는 Chrome 창은 동시에 하나만 열어야 합니다.

이미 로그인된 별도 Chrome에 연결해야 하면 `MARRIOTT_CDP_URL`에 그 전용 Chrome의 CDP WebSocket 주소를 지정할 수 있습니다. 일반 사용자의 기본 Chrome 프로필에는 연결하지 않습니다.

Windows Chrome과 NAT 방식 WSL을 함께 쓸 때는 Windows Node로 `scripts/cdp-tcp-forward.cjs`를 실행해 WSL 가상 어댑터 주소에만 전달 포트를 열 수 있습니다. 전달 대상은 로컬 전용 `127.0.0.1` Chrome 디버깅 포트이며, 공용 네트워크 주소에는 바인딩하지 않습니다.

```bash
MARRIOTT_BROWSER_CHANNEL=chrome \
MARRIOTT_USER_DATA_DIR=.auth/marriott-profile \
xvfb-run -a npm run auth:marriott

MARRIOTT_BROWSER_CHANNEL=chrome \
MARRIOTT_USER_DATA_DIR=.auth/marriott-profile \
xvfb-run -a npm run collect:full
```

`collect:full`은 Node 래퍼가 headful 모드를 설정하므로 Windows와 Linux에서 같은 npm 명령을 사용합니다. 화면이 없는 Linux/WSL 세션만 `xvfb-run -a`를 앞에 붙입니다. 실행 로그에는 사용한 channel 또는 executable, headful/headless, OS, persistent profile 여부가 기록됩니다. 수집이 차단되거나 실패하면 실패 요금은 `data/history.json`에 추가하지 않으며, 직전 성공값을 유지합니다.

## 매일 자동 실행

GitHub Actions가 매일 한국시간 00:30에 가격을 수집하고 `data/history.json`에 기록한 뒤 GitHub Pages를 갱신합니다. 저장소의 **Settings → Pages → Source**를 **GitHub Actions**로 설정해야 합니다.

실행 흐름은 다음과 같습니다.

1. GitHub Actions가 매일 00:30 KST에 저장소를 체크아웃합니다.
2. Node.js와 Playwright Chromium을 설치합니다.
3. `config/stays.json`에서 호텔·숙박일·성인 수·기준 예약가·객실 조건을 읽습니다.
4. Frankfurter API에서 EUR/JPY→KRW 환율을 받아 원화 참고값을 만듭니다. 가격 판단 기준은 예약 통화입니다.
5. 각 호텔을 Google Hotels에서 실제 날짜와 성인 2명 조건으로 순차 검색하며, 오사카는 JPY·유럽은 EUR로 조회합니다.
6. 헤드라인 최저가, 무료취소 요금, 객실명·침대 패턴까지 맞는 Google 요금을 분리합니다. 가격표가 비면 한 번 재시도합니다.
7. Xvfb 가상 화면의 실제 브라우저로 Marriott 공식 예약 페이지를 열고 `View Rates`를 펼쳐 동일 객실의 회원 변경 가능·무료취소 요금만 읽습니다. 실행 환경에서 로그인 상태가 제공되면 `MARRIOTT_AUTH_STATE`로 재사용하며, 객실 버튼이 연 정상 `rateListMenu.mi` 탭을 그대로 사용합니다. 선불·비환불 요금은 제외하며, 차단 또는 품절이면 오류를 저장하고 직전 유효값을 유지합니다.
8. Google 상세 가격표 링크와 Marriott 공식 예약 링크를 결과에 함께 저장합니다.
9. 결과와 수집 시각을 `data/history.json`에 최대 400회분 저장합니다.
10. `site/data.json`을 만들고 정적 파일을 GitHub Pages에 배포합니다.
11. 사이트는 예약 통화 기준으로 예약 총액을 수평선, Google 후보가와 Marriott 공식가를 날짜별 선으로 그립니다. 오늘 수집이 실패하면 최근 유효 결과와 그 시각을 표시합니다.

Actions의 `workflow_dispatch`를 사용하면 GitHub의 **Actions → Daily hotel price check → Run workflow**에서 수동 실행할 수도 있습니다.

Google이 GitHub Actions 트래픽을 차단하면 해당 호텔은 오류로 남습니다. 이 경우 로컬에서 `npm run collect`를 실행하면 이력을 계속 추가할 수 있습니다.

## BRG 주의

- 공식 BRG Verification Process 2항은 세금·팁·객실료 관련 기타 수수료를 비교에서 제외합니다. https://www.marriott.com/online-hotel-booking.mi (2026-10-11 확인). 납부 장소는 제외 여부에 영향을 주지 않습니다.
- `priceBreakdown`에 표시 총액·통화·각 비용 금액·총액 포함 여부·검증 여부·비용 명세 완전성을 보관하며 `roomOnlyFromBreakdown`으로 순수 객실료를 검산합니다. 표시 총액에 포함된 비용만 차감합니다. 현장 비용이 총액 밖 별도이면 비교에 더하지도 다시 빼지도 않습니다. 포함 여부/명세 미확인은 비교 보류합니다. OTA 예약 화면에서 이 명세를 자동 추출하는 어댑터는 아직 구현되지 않았습니다.

- 비교 카드의 주 금액은 내 예약 객실료 / Google 확인 객실료 / Marriott 공식 객실료 모두 세금 제외입니다. Google 세금 포함 총액은 참고값으로만 표시하며, 확인 세전액이 없으면 비교를 보류합니다. 가격 그래프도 확인된 세전 기록만 표시하며 기존 예약 세율을 이용한 역산·1박 반올림가의 단순 배수는 비교하지 않습니다.
- 2026-10-11 Google 실화면의 Price displayed 옵션은 Nightly total 및 Stay total 모두 taxes + fees 포함이며 세금 제외 옵션이 없습니다. Google 표시가를 임의로 세전가라고 저장하지 않습니다. 자동 세전액 확보에는 해당 판매처의 동일 요금 세금 내역/세전 총액 증빙이 필요합니다.

- Google 수집은 화면 달력의 선택된 ISO 날짜(연도 포함)와 성인·아동 컨트롤을 직접 검증합니다. 조건 미확인/불일치는 성공 이력에 넣지 않습니다. 객실 수가 화면에 없으면 미확인으로 남겨 BRG 완전 검증을 보류합니다.
- Google/Marriott 최신 시도는 `data/google-status.json`/`data/marriott-status.json`에 각각 보관합니다. 특정 수집원 생략 또는 일부 호텔 재조회는 다른 수집원의 상태를 덮어쓰지 않습니다. 실패는 마지막 성공 가격을 지우지 않습니다.
- GitHub의 배포 성공은 수집 성공이 아닙니다. 일부 호텔 수집 실패도 collector 종료코드와 별도 workflow 경고에 반영하며, 대시보드는 수집원별 마지막 시도·가격 수집 시각과 실패를 표시합니다.

- Marriott 공식 예약 후 24시간 안에 신청해야 합니다.
- 공개된 타사 요금이어야 합니다.
- 앱 전용·로그인 전용·비환불·패키지 요금은 기존 예약 조건과 다르면 제외됩니다.
- Google Hotels의 최저가는 객실 조건이 생략될 수 있어 `수동 확인` 표시는 신청 근거로 사용하면 안 됩니다.
- Marriott 수집값은 공식 예약 화면에서 확인한 동일 객실·일정·인원의 요금이며, 회원 로그인 상태에서 읽은 경우 회원 요금임을 기록합니다. 세금·요금 포함 여부와 무료취소 조건은 결과 필드와 공식 링크에서 재확인하세요. 회원가·세금 포함 최종 총액·무료취소 조건은 링크에서 재확인하세요.

export const marriottStatusLabels = {
  ok: "공식가 조회 성공",
  "blank-document": "공식 사이트 화면이 비어 있음",
  "navigation-timeout": "공식 사이트 이동 시간 초과",
  "dom-not-ready": "공식 사이트 화면 로드 실패",
  "login-required": "Marriott 로그인 필요",
  "session-expired": "로그인 세션 갱신 필요",
  blocked: "공식 사이트 접근 제한",
  captcha: "사람 확인이 필요함",
  "calendar-unavailable": "예약 달력을 열 수 없음",
  "room-unavailable": "해당 조건 예약 가능 객실 없음",
  "rate-list-transition-failed": "요금 목록 전환 실패",
  "rate-card-unavailable": "대상 객실 요금 카드 없음",
  "rate-parse-failed": "공식 요금 해석 실패",
  "profile-locked": "Marriott 전용 프로필 사용 중",
  "browser-launch-failed": "정식 브라우저 실행 실패"
};

export function marriottStatusLabel(state) {
  return marriottStatusLabels[state] ?? "공식가 확인 대기";
}

export function latestSuccessfulMarriott(runs, stayId, validator) {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const result = runs[index].results?.find((item) => item.id === stayId);
    const rate = validator(result);
    if (rate) return { rate, run: runs[index], index, stale: index !== runs.length - 1 };
  }
  return null;
}

/**
 * 메신저 메시지 포맷 유틸
 *
 * 배경 — 왜 이스케이프가 필요한가:
 *   구 messenger.sh는 parse_mode=HTML로 보내면서 본문을 이스케이프하지 않았다.
 *   그래서 current_task에 '<' 나 '&' 가 섞이면 Telegram이 400으로 거절하고,
 *   호출부가 `2>/dev/null || true` 라 실패가 무흔적으로 사라졌다 (알림 통째 유실).
 *   실측:
 *     {"ok":false,"error_code":400,"description":"Bad Request: can't parse
 *      entities: Unsupported start tag \"bar\" at byte offset 33"}
 *
 * parse_mode는 HTML을 유지한다. MarkdownV2는 이스케이프 대상이 18자로 늘어
 * 템플릿 전면 재작성을 유발하는데, 얻는 것이 없다.
 */

/**
 * Telegram HTML 파서가 요구하는 3자를 이스케이프한다.
 *
 * Telegram Bot API 문서 기준: HTML 파스 모드에서 태그로 쓰이지 않는
 * '&', '<', '>' 는 반드시 HTML 엔티티로 치환해야 한다.
 * '&' 를 가장 먼저 치환해야 한다 — 나중에 하면 앞서 만든 '&lt;' 의 '&'를
 * 다시 치환해 '&amp;lt;' 가 된다.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 굵은 글씨 서식을 조립한다.
 *
 * 순서가 핵심이다: **내용을 먼저 이스케이프한 뒤** 태그를 붙인다.
 * 반대로 하면(`escapeHtml('<b>' + text + '</b>')`) 서식 태그까지 escape돼
 * 사용자에게 '&lt;b&gt;' 리터럴이 그대로 보인다.
 *
 * 현재 메시지 템플릿에는 서식이 없다(전부 평문). 이 헬퍼는 알림 강화 단계에서
 * 서식을 넣을 때 조립 순서를 실수하지 않도록 하는 정식 경로다.
 */
export function bold(text: string): string {
  return `<b>${escapeHtml(text)}</b>`;
}

/**
 * 로그/에러 문자열에서 Telegram 봇 토큰을 지운다.
 *
 * 왜 필요한가: 전송 실패를 기록하려면 API 응답과 URL을 남겨야 하는데
 * 요청 URL은 `https://api.telegram.org/bot<TOKEN>/sendMessage` 형태라 토큰이 그대로 들어간다.
 * messenger.json은 600으로 잠겨 있지만 로그 파일과 DB는 그렇지 않고,
 * 특히 DB/로그는 컨텍스트 주입 경로를 타므로 토큰이 모델 입력까지 흘러갈 수 있다.
 * 기록 전 반드시 이 함수를 통과시킨다.
 */
export function redact(text: string): string {
  return (
    text
      // URL·본문에 등장하는 'bot<숫자>:<토큰>' 형태
      .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<REDACTED>')
      // 'bot' 접두사 없이 노출된 토큰 형태 (<숫자 8자 이상>:<35자 내외 시크릿>)
      .replace(/\b\d{8,}:[A-Za-z0-9_-]{20,}/g, '<REDACTED>')
  );
}

/**
 * 문자열을 **바이트 폭** 기준으로 오른쪽 공백 패딩한다.
 *
 * bash `printf "%-14s"` 는 문자가 아니라 바이트로 폭을 센다.
 * 예: "설정 파일:" 은 6자지만 UTF-8로 정확히 14바이트라 패딩이 붙지 않는다.
 * JS의 String.padEnd는 UTF-16 코드유닛(=6)으로 세서 공백 8개를 더 붙인다.
 * status 출력의 바이트 동일성을 지키려면 바이트로 세야 한다.
 */
export function padByte(text: string, width: number): string {
  const len = Buffer.byteLength(text, 'utf8');
  return len >= width ? text : text + ' '.repeat(width - len);
}

/**
 * 초를 사람이 읽는 문자열로 변환한다. (bash format_duration 동등)
 * 정수 나눗셈 기준이라 Math.floor를 쓴다.
 */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '1초 미만';
  const s = Math.floor(sec);
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  }
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return rest > 0 ? `${m}분 ${rest}초` : `${m}분`;
  }
  if (s > 0) return `${s}초`;
  return '1초 미만';
}

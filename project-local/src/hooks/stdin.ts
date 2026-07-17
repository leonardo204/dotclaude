/**
 * 훅 stdin 읽기
 *
 * 이전 구현은 'end' 이벤트와 50ms 하드 타임아웃을 경합시켰다.
 *   setTimeout(() => done(data.trim()), 50)
 * 이 방식은 페이로드가 크거나 파이프가 느리면 50ms 시점까지 도착한 만큼만
 * 읽고 나머지를 조용히 버린다(절단). Stop 페이로드의 last_assistant_message는
 * 실측 921자이며 수 KB까지 커질 수 있어 절단 위험이 실재한다.
 *
 * 수정: EOF('end')까지 정상적으로 끝까지 읽는다.
 * 대신 stdin이 연결되지 않은 경우(TTY 등)에는 즉시 반환해 행 걸림을 막는다.
 */

/** readStdin이 받는 최소 스트림 형태 (테스트 주입 가능). */
export type StdinLike = NodeJS.ReadableStream & {
  isTTY?: boolean;
  destroy?: (error?: Error) => void;
};

/**
 * 최후의 안전장치 타임아웃.
 *
 * 실제 훅 환경에서 Claude Code는 페이로드를 쓴 뒤 stdin을 닫는다(EOF).
 * (근거: 페이로드 포획에 `cat >> file`을 썼고 cat은 EOF에서만 종료하는데 정상 포획됐다.)
 * 따라서 이 타임아웃은 평상시 절대 발동하지 않는다.
 *
 * 다만 stdin이 TTY도 아니면서 EOF도 오지 않는 예외 상황에서 훅이 무한 대기하면
 * Claude 자체가 멈춘다. "훅 실패가 Claude를 막으면 안 된다"는 원칙에 따라 상한을 둔다.
 * 구(舊) 구현의 50ms와 달리 정상 페이로드(수 ms 내 도착)와는 경합하지 않는 크기다.
 */
const SAFETY_TIMEOUT_MS = 10_000;

/**
 * stdin을 EOF까지 모두 읽어 trim한 문자열로 반환한다.
 *
 * - TTY(대화형 터미널)면 보낼 데이터가 없으므로 즉시 '' 반환 → 행 걸리지 않음
 * - stdin이 즉시 닫히면 '' 반환
 * - 읽는 중 오류가 나면 그때까지 받은 데이터로 진행 (훅이 Claude를 막으면 안 됨)
 * - EOF가 끝내 오지 않으면 안전장치 타임아웃으로 수신분만 반환 (무한 대기 방지)
 */
export async function readStdin(
  stream: StdinLike = process.stdin,
  safetyTimeoutMs: number = SAFETY_TIMEOUT_MS
): Promise<string> {
  // 대화형 터미널에는 파이프된 페이로드가 없다. 기다리면 무한 대기가 된다.
  if (stream.isTTY) return '';

  let data = '';
  let completed = false;

  const read = (async (): Promise<void> => {
    try {
      stream.setEncoding('utf8');
      // for await은 'end'까지 정상 대기한다 (타임아웃 경합 없음 → 절단 없음).
      for await (const chunk of stream) {
        data += chunk;
      }
    } catch {
      // stdin 오류 시 지금까지 수신한 데이터로 진행
    } finally {
      completed = true;
    }
  })();

  let timer: NodeJS.Timeout | undefined;
  const safety = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, safetyTimeoutMs);
  });

  try {
    // 정상 경로는 read가 먼저 끝난다. safety는 EOF가 영원히 안 올 때만 이긴다.
    await Promise.race([read, safety]);
  } finally {
    clearTimeout(timer);
  }

  if (!completed) {
    // 안전장치 발동. 열린 stdin 핸들을 놓아주지 않으면 이벤트 루프가 살아 있어
    // 핸들러가 끝나도 프로세스가 종료되지 않는다(= Claude가 계속 막힌다).
    try {
      stream.destroy?.();
    } catch {
      // 무시 — 훅이 여기서 실패해도 Claude를 막으면 안 된다
    }
  }

  return data.trim();
}

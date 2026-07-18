// =============================================================
// Claude Code 훅 페이로드 (실측 포획 기준)
//
// 아래 타입은 추측이 아니라 실제 훅 페이로드를 직접 포획해 확정한 구조다.
// 픽스처: test/fixtures/{post-tool-use-bash,stop,notification}.jsonl
// 구조를 바꾸기 전에 반드시 재포획해서 검증할 것.
// (과거 post-bash.ts가 최상위 stdout/stderr을 읽어 에러 로깅이 4개월간
//  죽어 있었다. 같은 경로 착각의 재발을 막기 위해 타입으로 고정한다.)
// =============================================================

/** 모든 훅 페이로드에 공통으로 들어오는 필드. */
export interface HookInputBase {
  session_id: string;
  transcript_path: string;
  cwd: string;
  prompt_id: string;
  hook_event_name: string;
}

/** 추론 강도. 일부 훅 이벤트에만 포함된다. */
export interface EffortInfo {
  level: string;
}

/**
 * Bash 도구의 실행 결과.
 * 주의: stdout/stderr은 페이로드 최상위가 아니라 tool_response 하위에 있다.
 */
export interface BashToolResponse {
  stdout: string;
  stderr: string;
  interrupted: boolean;
  isImage: boolean;
  noOutputExpected: boolean;
}

/** PostToolUse 훅 입력 (Bash 도구 기준 실측). */
export interface PostToolUseInput extends HookInputBase {
  permission_mode: string;
  effort: EffortInfo;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: BashToolResponse;
  tool_use_id: string;
  duration_ms: number;
}

/**
 * PostToolUseFailure 훅 입력 (Bash 도구 기준 실측).
 *
 * 주의: PostToolUse와 구조가 다르다. 혼동하면 또 4개월을 날린다.
 *   - `tool_response`가 **없다**. 실패 정보는 최상위 `error` 문자열 하나에 담긴다.
 *   - `error`의 첫 줄은 "Exit code N", 그 다음 줄부터 실제 에러 출력이다.
 *   - `is_interrupt`는 사용자 ESC 중단 여부다 (true면 에러가 아니다).
 *
 * 공식 문서상 PostToolUse는 "After a tool call succeeds", PostToolUseFailure는
 * "After a tool call fails"다. 실패한 명령은 PostToolUse로 오지 않는다.
 * 픽스처: test/fixtures/post-tool-use-failure-bash.jsonl
 */
export interface PostToolUseFailureInput extends HookInputBase {
  permission_mode: string;
  effort: EffortInfo;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  /** 예: "Exit code 2\nls: cannot access '/nope': No such file or directory" */
  error: string;
  /** 사용자가 ESC로 취소했는지. true면 실패가 아니라 중단이다. */
  is_interrupt: boolean;
  duration_ms: number;
}

/** Stop 훅이 보고하는 백그라운드 작업. */
export interface BackgroundTask {
  id: string;
  type: string;
  status: string;
  description: string;
  agent_type?: string;
}

/**
 * Stop 훅 입력 (실측).
 * 주의: `reason` 필드는 존재하지 않는다. 과거 dead 선언이 소비처의 버그를 유발했으므로
 * 실측에 없는 필드를 추측으로 추가하지 말 것.
 */
export interface StopInput extends HookInputBase {
  permission_mode: string;
  effort: EffortInfo;
  stop_hook_active: boolean;
  last_assistant_message: string;
  background_tasks: BackgroundTask[];
  session_crons: unknown[];
}

/** Notification 훅 입력 (실측). permission_mode/effort는 오지 않는다. */
export interface NotificationInput extends HookInputBase {
  message: string;
  notification_type: string;
}

/**
 * 훅 stdin은 외부 입력이라 신뢰할 수 없다.
 * JSON.parse 경계에서는 모든 최상위 필드를 optional로 다뤄 런타임 예외를 막는다.
 */
export type RawHookInput<T> = { [K in keyof T]?: T[K] };

export interface SessionInfo {
  id: number;
  start_time: string;
  end_time?: string;
  duration_minutes?: number;
  location?: string;
  summary?: string;
  files_changed?: number;
  commits_made?: number;
}

export interface Decision {
  id: number;
  date: string;
  description: string;
  reason?: string;
  related_files?: string;
  status?: string;
}

export interface ErrorEntry {
  id: number;
  session_id?: number;
  tool_name?: string;
  error_type?: string;
  file_path?: string;
  resolution?: string;
  timestamp: string;
}

export interface DBStats {
  sessions: number;
  decisions: number;
  errors: number;
  tool_usage: number;
  live_context: number;
}

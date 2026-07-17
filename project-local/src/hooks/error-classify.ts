/**
 * Bash 에러 감지 · 분류 (PostToolUse / PostToolUseFailure 공용)
 *
 * 두 경로의 요구가 다르다:
 *   - PostToolUseFailure(실패 확정) → 게이트 불필요. classifyError()로 분류만 한다.
 *   - PostToolUse(성공, exit 0)     → looksLikeError() 게이트를 통과한 출력만 기록한다.
 *
 * 게이트 설계 원칙 — 단어 하나가 아니라 문맥 있는 패턴을 쓴다.
 * 구(舊) 게이트 /error|failed|fatal/는 "Found 0 errors" 같은 성공 출력까지 잡아
 * errors 테이블에 37행의 가짜 에러를 남겼다. 특히 구 분류기의 /permission/은
 * 페이로드에 항상 존재하는 permission_mode 문자열에 걸려 19행을 오분류했다.
 * 그래서 여기서는 "permission"이 아니라 "permission denied" 구문을 본다.
 */

export type ErrorCategory =
  | 'build_fail'
  | 'test_fail'
  | 'conflict'
  | 'permission'
  | 'runtime_error';

/** 카테고리별 분류 규칙. 배열 순서대로 먼저 걸리는 규칙이 이긴다. */
const CATEGORY_RULES: ReadonlyArray<{
  category: ErrorCategory;
  patterns: RegExp[];
}> = [
  {
    category: 'build_fail',
    patterns: [
      /\bbuild\s+fail(?:ed|ure|s)\b/i,
      /\bcompilation\s+(?:error|failed)\b/i,
      /\bcompile\s+error\b/i,
      /\berror\s+TS\d+\b/, // tsc: "error TS2304: Cannot find name"
      /\berror\[E\d+\]/, // rustc: "error[E0433]"
    ],
  },
  {
    category: 'test_fail',
    patterns: [
      // "0 tests failed"는 성공 출력이므로 앞에 숫자가 붙은 형태를 배제한다.
      /(?<!\d\s)\btests?\s+fail(?:ed|ing|ure|ures)\b/i,
      /(?<![\d.])(?!0+\b)\d+\s+(?:tests?|specs?|assertions?)\s+fail(?:ed|ing)\b/i,
      /\bfail(?:ed|ing)\s+tests?\b/i,
      /\bassertion\s+fail(?:ed|ure)\b/i,
    ],
  },
  {
    category: 'conflict',
    patterns: [
      /\bmerge\s+conflict\b/i,
      /^CONFLICT\s*\(/m, // git: "CONFLICT (content): Merge conflict in x"
      /\bautomatic\s+merge\s+failed\b/i,
      /\bfix\s+conflicts\b/i,
    ],
  },
  {
    category: 'permission',
    patterns: [
      // 구 분류기의 치명적 오류: /permission/ 단독 → permission_mode에 오탐.
      /\bpermission\s+denied\b/i,
      /\boperation\s+not\s+permitted\b/i,
      /\b(?:EACCES|EPERM)\b/,
    ],
  },
];

/**
 * 성공(exit 0) 출력에서 "그래도 에러 같다"를 판정하는 게이트.
 * 각 패턴은 정상 출력에 우연히 등장하기 어려운 문맥을 요구한다.
 */
const ERROR_SIGNATURES: readonly RegExp[] = [
  // --- 셸 / OS 레벨 ---
  /:\s*No such file or directory\b/i,
  /:\s*command not found\b/i,
  /\bpermission denied\b/i,
  /\boperation not permitted\b/i,
  /\b(?:EACCES|EPERM|ENOENT)\b/,
  /\bsegmentation fault\b/i,
  /\bbus error\b/i,
  /\bKilled:\s*\d+/, // macOS OOM/시그널: "Killed: 9"
  // --- 툴체인 ---
  /\bnpm ERR!/,
  /\berror\s+TS\d+\b/,
  /\berror\[E\d+\]/,
  // 라인 머리의 "fatal:" / "error:" (git, gcc, cargo 등)
  /(?:^|\n)\s*(?:fatal|error)(?:\[[^\]]+\])?:\s/i,
  // 대문자 ERROR: 는 강한 신호 (esbuild "src/app.ts:3:10: ERROR: ...")
  /\bERROR:\s/,
  // --- 빌드 / 테스트 / 머지 ---
  /\bbuild\s+fail(?:ed|ure|s)\b/i,
  /\bcompilation\s+(?:error|failed)\b/i,
  /(?<!\d\s)\btests?\s+fail(?:ed|ing|ure|ures)\b/i,
  /(?<![\d.])(?!0+\b)\d+\s+(?:tests?|specs?|assertions?)\s+fail(?:ed|ing)\b/i,
  /\bmerge\s+conflict\b/i,
  /^CONFLICT\s*\(/m,
  /\bautomatic\s+merge\s+failed\b/i,
];

/**
 * 출력이 에러처럼 보이는지 판정한다 (PostToolUse 성공 경로 전용 게이트).
 * PostToolUseFailure 경로에서는 호출하지 마라 — 이미 실패가 확정이다.
 */
export function looksLikeError(output: string): boolean {
  return ERROR_SIGNATURES.some((re) => re.test(output));
}

/**
 * 에러 텍스트를 카테고리로 분류한다. 어디에도 걸리지 않으면 runtime_error로 폴백한다.
 * 반환값이 항상 non-empty이므로 "분류 실패"와 "에러 아님"을 혼동할 수 없다.
 * (에러 여부 판정은 looksLikeError의 책임이다.)
 */
export function classifyError(output: string): ErrorCategory {
  for (const { category, patterns } of CATEGORY_RULES) {
    if (patterns.some((re) => re.test(output))) return category;
  }
  return 'runtime_error';
}

/**
 * PostToolUseFailure의 error 첫 줄에서 종료 코드를 파싱한다.
 * 예: "Exit code 2\nls: cannot access ..." → 2
 * 형식이 다르면 null (호출부는 null이어도 기록을 계속해야 한다).
 */
export function parseExitCode(errorText: string): number | null {
  const match = errorText.match(/^\s*exit code (\d+)/i);
  if (!match?.[1]) return null;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : null;
}

/** 에러 출력에서 파일 경로처럼 보이는 첫 토큰을 뽑는다. 없으면 ''. */
export function extractFile(output: string): string {
  const match = output.match(/(?:^|[\s:])([^\s:]+\.[a-zA-Z]{1,10})(?:[\s:]|$)/);
  return match?.[1] ?? '';
}

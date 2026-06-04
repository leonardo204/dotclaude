/**
 * dotclaude 구현 파이프라인 workflow
 * planner → architect → (ralph + test-engineer) → verifier → reviewer
 *
 * 우리 7개 네이티브 subagent(.claude/agents/*.md)를 agentType으로 오케스트레이션한다.
 * 수동 위임 파이프라인을 "결정적·재현 가능한 스크립트"로 굳힌 형태.
 *
 * 실행:
 *   Workflow(scriptPath: ".claude/workflows/dotclaude-implement.js",
 *            args: { request: "구현 요청 자연어" })
 *
 * opt-in: 대규모 작업에만. 소규모/일상 구현은 수동 위임이 더 가볍다.
 * DB 연결(C): workflow는 파일시스템/Bash 접근이 없으므로, 반환값을 메인이 받아
 *   `helper.sh decision-add/commit-log`로 Context DB에 기록한다(세션 간 영속).
 */

export const meta = {
  name: 'dotclaude-implement',
  description:
    '구현 파이프라인 — planner→architect→(ralph+test-engineer)→verifier→reviewer 결정적 오케스트레이션',
  phases: [
    { title: 'Plan', detail: 'planner 태스크 분해 + 수용 기준' },
    { title: 'Design', detail: 'architect 타당성 검토(PASS/FAIL)' },
    { title: 'Build', detail: 'ralph 구현 + test-engineer 테스트 (병렬)' },
    { title: 'Verify', detail: 'verifier 빌드/타입/테스트 검증(PASS/FAIL)' },
    { title: 'Review', detail: 'reviewer 보안/정확성/품질 리뷰' },
  ],
}

// 판정용 구조화 스키마 (JSON Schema)
const VERDICT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    summary: { type: 'string' },
  },
  required: ['verdict', 'summary'],
}

const request =
  (args && (args.request ?? (typeof args === 'string' ? args : null))) ??
  '요청이 args.request로 전달되지 않았습니다.'

// 1. Plan — planner
phase('Plan')
const plan = await agent(
  `다음 요청의 구현 계획(태스크 분해 + 수용 기준 + 리스크)을 수립하라.\n요청: ${request}`,
  { agentType: 'planner', phase: 'Plan' }
)

// 2. Design — architect 판정. FAIL이면 중단(계획 재수립 후 재실행).
phase('Design')
const design = await agent(
  `다음 구현 계획의 아키텍처 타당성을 검토하고 PASS/FAIL로 판정하라.\n계획:\n${plan}`,
  { agentType: 'architect', phase: 'Design', schema: VERDICT }
)
if (design.verdict === 'FAIL') {
  log('architect FAIL — 계획 재수립 필요. 파이프라인 중단.')
  return { stopped: 'design-rejected', plan, design }
}

// 3. Build — ralph 구현 + test-engineer 테스트 (병렬)
phase('Build')
const [impl, tests] = await parallel([
  () =>
    agent(`승인된 계획을 구현하라. 빌드/테스트 통과까지 완료하라.\n계획:\n${plan}`, {
      agentType: 'ralph',
      phase: 'Build',
    }),
  () =>
    agent(`구현 대상의 테스트를 작성하라.\n계획:\n${plan}`, {
      agentType: 'test-engineer',
      phase: 'Build',
    }),
])

// 4. Verify — verifier 판정. FAIL이면 debugger 진단 후 중단(ralph 재진입 권장).
phase('Verify')
const verify = await agent(
  `빌드/타입체크/테스트를 실행해 구현을 검증하고 PASS/FAIL로 판정하라.`,
  { agentType: 'verifier', phase: 'Verify', schema: VERDICT }
)
if (verify.verdict === 'FAIL') {
  log('verifier FAIL — debugger 진단 후 ralph 재진입 권장.')
  const diagnosis = await agent(
    `검증 실패의 근본 원인을 진단하고 수정 방향을 제시하라.\n검증 결과: ${verify.summary}`,
    { agentType: 'debugger', phase: 'Verify' }
  )
  return { stopped: 'verify-failed', plan, impl, tests, verify, diagnosis }
}

// 5. Review — reviewer 최종 리뷰
phase('Review')
const review = await agent(
  `구현된 코드를 보안/정확성/품질 관점에서 리뷰하라(git diff 변경 파일만).`,
  { agentType: 'reviewer', phase: 'Review' }
)

return { plan, design, impl, tests, verify, review }

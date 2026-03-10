---
description: "계획 → 설계 → 구현 → 검증 → 리뷰 파이프라인 실행"
argument-hint: "<구현할 기능 설명>"
---

사용자 요청을 계획 → 설계 검토 → 구현 → 검증 파이프라인으로 실행

## 파이프라인 개요

```
[사용자 요청] → [계획] → [승인] → [설계 검토] → [승인] → [구현 + 테스트 작성] → [검증] → [리뷰] → [정리] → [사용자 확인]
                                                            ↑ 실패 시 [debugger 진단] → ralph 재진입 ←──┘
```

## 실행 순서

### Phase 1: 계획 수립

Planner 에이전트에게 위임:

```
Agent(subagent_type="planner", prompt="사용자 요청: {요청 내용}. 코드베이스를 탐색하고 구현 계획을 수립하세요.")
```

결과를 사용자에게 보여주고 **승인/수정 요청**:
- 승인 → Phase 2로
- 수정 요청 → 수정 후 다시 사용자 확인
- 이 과정을 사용자가 승인할 때까지 반복

### Phase 2: 설계 검토

Architect 에이전트에게 계획 검토 위임:

```
Agent(subagent_type="architect", prompt="다음 구현 계획을 검토하세요: {계획 내용}")
```

Architect 검토 결과를 사용자에게 보여주고 **승인/수정 요청**:
- ✅ APPROVED → Phase 3로
- ⚠️ CONDITIONAL → 수정 사항 반영 후 사용자 확인
- ❌ REJECTED → 계획 재수립 (Phase 1로)

### Phase 3: 구현 + 테스트 작성

Ralph와 Test Engineer를 **병렬 실행**:

```
# 병렬 실행
Agent(subagent_type="ralph", prompt="다음 계획을 구현하세요. 모든 태스크를 빠짐없이 완료하고, 빌드가 통과할 때까지 반복하세요. 계획: {승인된 계획}")

Agent(subagent_type="test-engineer", prompt="다음 계획의 구현에 대한 테스트를 설계하고 작성하세요. 기존 테스트 패턴을 따르세요. 계획: {승인된 계획}")
```

- Ralph: 기능 구현에 집중
- Test Engineer: 테스트 코드 작성에 집중
- 둘 다 완료 후 Phase 4로

### Phase 4: 검증

Verifier 에이전트에게 검증 위임:

```
Agent(subagent_type="verifier", prompt="구현이 완료되었습니다. 빌드, 테스트, 타입체크를 실행하고 수용 기준을 확인하세요. 수용 기준: {계획의 수용 기준}")
```

결과:
- ✅ PASS → Phase 5로
- ❌ FAIL → **Debugger로 진단 후 Ralph가 수정**:
  ```
  # 순차 실행
  Agent(subagent_type="debugger", prompt="검증 실패. 다음 에러를 진단하세요: {실패 내용}")
  # debugger 진단 결과를 ralph에게 전달
  Agent(subagent_type="ralph", prompt="다음 진단 결과를 바탕으로 수정하세요: {진단 결과}")
  # 수정 후 Phase 4 재진입 (최대 3회)
  ```

### Phase 5: 코드 리뷰

Reviewer 에이전트에게 리뷰 위임:

```
Agent(subagent_type="reviewer", prompt="변경된 코드를 리뷰하세요. git diff로 변경 범위를 확인하세요.")
```

결과:
- ✅ LGTM → Phase 6로
- ⚠️ 수정 후 승인 → 수정 사항을 사용자에게 보여주고 Ralph 수정 여부 확인
- ❌ 재작업 필요 → Ralph에게 수정 요청 (Phase 3 재진입)

### Phase 6: 정리 및 사용자 확인

1. 변경 요약 작성:
   - 수정/생성/삭제된 파일 목록
   - 주요 변경 내용 3줄 요약
   - 검증 결과 (빌드/테스트/리뷰)

2. Context DB에 기록:
   ```bash
   bash .claude/db/helper.sh decision-add "구현 완료: {요약}"
   bash .claude/db/helper.sh task-done {task_id}
   ```

3. 사용자에게 최종 확인 요청:
   ```
   ## 구현 완료

   ### 변경 요약
   - {파일 목록}
   - {주요 변경}

   ### 검증 결과
   - 빌드: ✅
   - 테스트: ✅ (N/N 통과)
   - 코드 리뷰: ✅ LGTM

   커밋하시겠습니까? → /project:commit
   ```

## 중요 원칙

- **각 Phase 사이에 사용자 승인**: Phase 1→2, Phase 2→3 전환 시 사용자 확인 필수
- **Phase 3 이후는 자동**: Ralph+TestEngineer → Verifier → Reviewer는 자동 파이프라인
- **실패 시 진단 → 수정 루프**: 검증 실패 → debugger 진단 → ralph 수정 (최대 3회)
- **강제 중단**: 사용자가 "중단" 요청 시 즉시 중단하고 현재 상태 보고

## 파이프라인 외 독립 사용

에이전트는 파이프라인 없이 직접 호출해도 된다:

| 상황 | 에이전트 |
|------|----------|
| "이 버그 원인 좀 찾아줘" | `debugger` 단독 |
| "이 기능에 테스트 추가해줘" | `test-engineer` 단독 |
| "이거 구현해줘 (단순)" | `ralph` 단독 |
| "이 코드 리뷰해줘" | `reviewer` 단독 |
| "이 설계 검토해줘" | `architect` 단독 |

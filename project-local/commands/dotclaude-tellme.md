---
description: "최근 작업 브리핑 + 다음 할 일 제안"
---

최근 작업 브리핑 + 다음 할 일 제안

## 실행 순서

1. Remote sync 확인:
   - 최근 커밋: !`git log --oneline -10 HEAD`
   - 미푸시 커밋: !`git log --oneline origin/main..HEAD 2>/dev/null || echo "(remote 없음)"`
   - 리모트 전용: !`git log --oneline HEAD..origin/main 2>/dev/null || echo "(remote 없음)"`

2. SQLite에서 최근 세션/작업 조회:
   - 최근 세션: !`sqlite3 -header -column .claude/db/context.db "SELECT id, start_time, end_time FROM sessions ORDER BY id DESC LIMIT 5;" 2>/dev/null || echo "(DB 없음)"`
   - 미완료 태스크: !`sqlite3 -header -column .claude/db/context.db "SELECT id, priority, status, description FROM tasks WHERE status IN ('pending','in_progress') ORDER BY priority;" 2>/dev/null || echo "(없음)"`
   - 최근 결정: !`sqlite3 -header -column .claude/db/context.db "SELECT id, date, description FROM decisions ORDER BY id DESC LIMIT 5;" 2>/dev/null || echo "(없음)"`

3. 최근 변경 사항을 사용자에게 요약 설명:
   - 마지막 세션에서 무엇을 했는지
   - 리모트와 로컬의 차이
   - 미완료 태스크 목록

4. 다음 할 일 제안:
   - 미완료 태스크 중 우선순위 높은 것
   - archive/TODO-PLAN.md 참조
   - 최근 패턴 기반 예상 작업

## 출력 형식
```
## 최근 작업 요약
- [날짜] 작업 내용...

## 현재 상태
- 로컬/리모트 동기화: 상태
- 미완료 태스크: N개

## 다음 할 일 제안
1. (우선순위 높음) 내용...
2. 내용...
```

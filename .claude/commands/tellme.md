최근 작업 브리핑 + 다음 할 일 제안

## 실행 순서

1. Remote sync 확인:
   ```bash
   git fetch origin
   git log --oneline -10 HEAD
   git log --oneline origin/main..HEAD  # 아직 안 푸시한 커밋
   git log --oneline HEAD..origin/main  # 리모트에만 있는 커밋
   ```

2. SQLite에서 최근 세션/작업 조회:
   ```bash
   sqlite3 .claude/db/context.db "SELECT * FROM sessions ORDER BY id DESC LIMIT 5;"
   sqlite3 .claude/db/context.db "SELECT * FROM commits ORDER BY id DESC LIMIT 10;"
   sqlite3 .claude/db/context.db "SELECT * FROM tasks WHERE status IN ('pending','in_progress') ORDER BY priority;"
   sqlite3 .claude/db/context.db "SELECT * FROM decisions ORDER BY id DESC LIMIT 5;"
   ```

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

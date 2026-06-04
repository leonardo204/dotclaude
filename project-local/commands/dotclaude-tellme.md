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

5. 작업 저널 (사용자가 "저널", "standup", "주간 요약" 요청 시):
   - 기간 커밋을 타입별로 분류 (기본 7일, "오늘"이면 1일):
     !`sqlite3 -header -column .claude/db/context.db "SELECT CASE WHEN message LIKE '[Feature]%' THEN 'Feature' WHEN message LIKE '[Fix]%' THEN 'Fix' WHEN message LIKE '[UI]%' THEN 'UI' WHEN message LIKE '[Docs]%' THEN 'Docs' WHEN message LIKE '[Refactor]%' THEN 'Refactor' ELSE 'Other' END AS type, COUNT(*) AS cnt FROM commits WHERE timestamp >= date('now','-7 days') GROUP BY type ORDER BY cnt DESC;" 2>/dev/null || echo "(없음)"`
   - 기간 편집 핫스팟:
     !`sqlite3 -header -column .claude/db/context.db "SELECT file_path, COUNT(*) AS edits FROM tool_usage WHERE tool_name='Edit' AND timestamp >= date('now','-7 days') GROUP BY file_path ORDER BY edits DESC LIMIT 8;" 2>/dev/null || echo "(없음)"`
   - 기간 해결한 에러 / 내린 결정:
     !`sqlite3 -header -column .claude/db/context.db "SELECT error_type, COUNT(*) AS cnt FROM errors WHERE timestamp >= date('now','-7 days') GROUP BY error_type ORDER BY cnt DESC;" 2>/dev/null || echo "(없음)"`
     !`sqlite3 -header -column .claude/db/context.db "SELECT date, description FROM decisions WHERE date >= date('now','-7 days') ORDER BY id DESC LIMIT 10;" 2>/dev/null || echo "(없음)"`
   - 위 데이터를 의도별(Feature/Fix/…)로 그룹핑 + 파일 영향 + 결정/에러를 엮어 **서사형 회고**로 작성

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

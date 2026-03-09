Context DB 전체 현황 리포트

## 실행

```bash
# 기본 통계
bash .claude/db/helper.sh stats

# 세션 이력 (최근 10개)
sqlite3 -header -column .claude/db/context.db "SELECT id, start_time, end_time, files_changed, commits_made FROM sessions ORDER BY id DESC LIMIT 10;"

# 커밋 이력 (최근 15개)
sqlite3 -header -column .claude/db/context.db "SELECT hash, message, timestamp FROM commits ORDER BY id DESC LIMIT 15;"

# 미완료 태스크
sqlite3 -header -column .claude/db/context.db "SELECT id, priority, status, description, category FROM tasks WHERE status IN ('pending','in_progress') ORDER BY priority;"

# 완료 태스크 (최근 10개)
sqlite3 -header -column .claude/db/context.db "SELECT id, description, completed_at FROM tasks WHERE status='done' ORDER BY completed_at DESC LIMIT 10;"

# 설계 결정 이력
sqlite3 -header -column .claude/db/context.db "SELECT id, date, description, reason, status FROM decisions ORDER BY id DESC LIMIT 10;"

# 에러 로그 (최근 10개)
sqlite3 -header -column .claude/db/context.db "SELECT error_type, file_path, resolution, timestamp FROM errors ORDER BY id DESC LIMIT 10;"

# 컨텍스트 항목 (카테고리별 집계)
sqlite3 -header -column .claude/db/context.db "SELECT category, COUNT(*) as count FROM context GROUP BY category ORDER BY count DESC;"

# Live Context (현재 상태)
bash .claude/db/helper.sh live-dump

# 도구 사용 빈도 (상위 10)
sqlite3 -header -column .claude/db/context.db "SELECT tool_name, COUNT(*) as count FROM tool_usage GROUP BY tool_name ORDER BY count DESC LIMIT 10;"

# 파일 편집 빈도 (상위 10)
sqlite3 -header -column .claude/db/context.db "SELECT file_path, COUNT(*) as count FROM tool_usage WHERE tool_name='Edit' GROUP BY file_path ORDER BY count DESC LIMIT 10;"
```

## 출력 형식

```
## Context DB Report

### 통계 요약
- 세션: N회 | 커밋: N건 | 태스크: N(완료)/N(미완료) | 에러: N건

### 세션 이력
(테이블)

### 커밋 이력
(테이블)

### 태스크
- 미완료: (목록)
- 최근 완료: (목록)

### 설계 결정
(목록)

### 에러 로그
(목록 또는 "없음")

### Live Context
(현재 저장된 상태)

### 도구/파일 사용 빈도
(상위 항목)
```

조회만 수행. 분석/제안 없이 있는 그대로 보고.

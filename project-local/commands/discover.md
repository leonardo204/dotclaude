SQLite context 분석 → 자동화 가능한 패턴 발견 → skill/command/hook 제안

## 실행 순서

1. 데이터 충분성 확인:
   ```bash
   sqlite3 .claude/db/context.db "SELECT COUNT(*) FROM sessions;"
   sqlite3 .claude/db/context.db "SELECT COUNT(*) FROM tool_usage;"
   sqlite3 .claude/db/context.db "SELECT COUNT(*) FROM commits;"
   sqlite3 .claude/db/context.db "SELECT COUNT(*) FROM errors;"
   ```
   세션 10회 미만이면 "데이터가 아직 부족합니다. N회 더 작업 후 다시 시도해주세요." 안내

2. 패턴 분석 쿼리 실행:

   a. 파일 편집 빈도 (핫스팟):
   ```sql
   SELECT file_path, COUNT(*) as cnt FROM tool_usage
   WHERE tool_name='Edit' GROUP BY file_path ORDER BY cnt DESC LIMIT 10;
   ```

   b. 시간대별 작업 패턴:
   ```sql
   SELECT strftime('%H', start_time) as hour, COUNT(*) as cnt
   FROM sessions GROUP BY hour ORDER BY cnt DESC;
   ```

   c. 요일별 작업 패턴:
   ```sql
   SELECT strftime('%w', start_time) as weekday, COUNT(*) as cnt
   FROM sessions GROUP BY weekday ORDER BY weekday;
   ```

   d. 세션당 평균 작업 시간:
   ```sql
   SELECT AVG(duration_minutes) FROM sessions WHERE duration_minutes > 0;
   ```

   e. 자주 발생하는 에러 유형:
   ```sql
   SELECT error_type, COUNT(*) as cnt FROM errors
   GROUP BY error_type ORDER BY cnt DESC LIMIT 5;
   ```

   f. 커밋 패턴 (타입별):
   ```sql
   SELECT
     CASE
       WHEN message LIKE '[Feature]%' THEN 'Feature'
       WHEN message LIKE '[Fix]%' THEN 'Fix'
       WHEN message LIKE '[UI]%' THEN 'UI'
       WHEN message LIKE '[Docs]%' THEN 'Docs'
       WHEN message LIKE '[Refactor]%' THEN 'Refactor'
       ELSE 'Other'
     END as type,
     COUNT(*) as cnt
   FROM commits GROUP BY type ORDER BY cnt DESC;
   ```

   g. 파일 동시 편집 패턴 (함께 수정되는 파일):
   ```sql
   SELECT a.file_path, b.file_path, COUNT(*) as co_edit_count
   FROM tool_usage a
   JOIN tool_usage b ON a.session_id = b.session_id AND a.file_path < b.file_path
   WHERE a.tool_name='Edit' AND b.tool_name='Edit'
   GROUP BY a.file_path, b.file_path
   HAVING co_edit_count >= 3
   ORDER BY co_edit_count DESC LIMIT 10;
   ```

3. 패턴 해석 및 제안 생성:

   | 발견 패턴 | 제안 유형 | 제안 내용 |
   |----------|----------|----------|
   | 특정 파일 편집 빈도 매우 높음 | Command | 해당 파일 전용 가이드 커맨드 |
   | 파일 A, B가 항상 함께 편집됨 | Hook | A 편집 시 B도 확인 리마인더 |
   | 특정 에러 반복 발생 | Command | 자동 수정 커맨드 |
   | 커밋 전 항상 같은 명령 실행 | Hook | PreToolUse에 자동화 |
   | 특정 요일/시간 집중 작업 | Context | 작업 패턴 인사이트 |
   | 세션 시작마다 같은 질문 | Hook | SessionStart에 자동 답변 |

4. 결과를 사용자에게 보고:
   ```
   ## Discover Report (세션 N회 기반)

   ### 핫스팟 파일
   - file.swift (편집 N회)

   ### 자동화 제안
   1. [Hook 제안] 내용...
   2. [Command 제안] 내용...

   ### 작업 패턴 인사이트
   - 주로 N요일에 작업
   - 평균 세션 N분
   ```

5. 사용자가 제안을 승인하면 해당 hook/command/skill 자동 생성

Smart commit: 변경 사항 분석 → 관련 문서 업데이트 → 기능별 커밋 → 푸시

## 실행 순서

1. `git status`와 `git diff`로 변경된 파일 목록 파악
1-1. **Context DB만 변경된 경우 스킵**: 변경 파일이 `.claude/db/context.db` 하나뿐이면, 실제 작업 없이 DB만 업데이트된 것이므로 커밋하지 않고 사용자에게 "Context DB만 변경되었습니다. 커밋할까요?" 확인. 사용자가 명시적으로 요청한 경우에만 커밋 진행.
2. 변경 내용을 기능 단위로 그룹핑
3. 각 그룹에 대해:
   a. 관련 문서 업데이트 필요 여부 확인 (CLAUDE.md 및 상세 문서 링크 참조)
   b. 필요하면 문서 수정
   c. 해당 그룹 파일들만 `git add`
   d. 커밋 컨벤션에 맞게 커밋: [Feature], [Fix], [UI], [Refactor], [Docs]
4. 모든 커밋 완료 후 `git push origin main`
5. SQLite에 커밋 기록 저장:
   ```bash
   sqlite3 .claude/db/context.db "INSERT INTO commits (session_id, hash, message, files_changed) VALUES ($(sqlite3 .claude/db/context.db 'SELECT id FROM sessions ORDER BY id DESC LIMIT 1'), '<hash>', '<message>', '<files_json>');"
   ```

## 커밋 컨벤션
```
[타입] 간단한 설명

타입: Init, Feature, UI, Fix, Refactor, Docs
```

## 문서 업데이트 대상
- `CLAUDE.md`: 프로젝트 가이드 (기능 추가/삭제/변경 시)
- CLAUDE.md `### 상세 문서`에 링크된 ref-docs: 코드 가이드 문서 (아키텍처 변경 시)
- `archive/`: 완료된 계획 이동 시

## 주의사항
- .env, Secrets.plist, API 키 파일은 절대 커밋하지 않음
- 커밋 전 conflict marker (`<<<<<<<`) 잔존 여부 확인
- 큰 변경은 기능별로 분리 커밋 (한 커밋에 섞지 않음)

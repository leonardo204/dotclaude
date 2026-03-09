# Claude Code Rules — 프로젝트 템플릿

새 프로젝트에 Claude Code 개발 환경을 빠르게 구축하기 위한 **스타터 킷**.
OMC(oh-my-claudecode) 종속 없이 Claude Code 네이티브 기능만으로 동작합니다.

---

## 폴더 구조

```
ClaudeCodeRules/
├── README.md                          ← 이 파일
├── CLASSIFICATION.md                  ← OMC vs Native 분류 참고 문서
├── global/                            ← ~/.claude/ 글로벌 설정
│   ├── CLAUDE.md                      # 글로벌 개발 가이드 (네이티브 Agent 기반)
│   ├── settings.json                  # 글로벌 설정 (statusline, 플러그인)
│   ├── commands/                      # 글로벌 커스텀 명령어
│   │   ├── project-init.md            #   새 프로젝트 초기화
│   │   └── project-migration.md       #   기존 프로젝트 마이그레이션
│   ├── scripts/                       # 글로벌 스크립트
│   │   └── context-monitor.mjs        #   HUD + 컨텍스트 모니터링
│   └── MEMORY-example.md             # 프로젝트별 자동 메모리 예시
├── project-local/                     ← 프로젝트 .claude/ + CLAUDE.md 템플릿
│   ├── CLAUDE.md                      # 프로젝트 가이드 템플릿 (COMMON + PROJECT)
│   ├── settings.json                  # Hook 등록 설정
│   ├── agents/                        # 커스텀 에이전트 정의
│   │   ├── ralph.md                   #   끈질긴 구현 에이전트
│   │   ├── planner.md                 #   계획 수립 에이전트
│   │   ├── architect.md               #   설계 검토 에이전트
│   │   ├── verifier.md                #   테스트 검증 에이전트
│   │   ├── reviewer.md               #   코드 리뷰 에이전트
│   │   ├── debugger.md                #   버그 원인 진단 에이전트
│   │   └── test-engineer.md           #   테스트 설계/작성 에이전트
│   ├── commands/                      # 커스텀 슬래시 명령어 (/project:*)
│   │   ├── implement.md               #   전체 파이프라인 (계획→설계→구현→검증→리뷰)
│   │   ├── commit.md                  #   문서 업데이트 + 기능별 커밋 + 푸시
│   │   ├── discover.md                #   DB 패턴 분석 → 자동화 제안
│   │   ├── reportdb.md                #   Context DB 현황 리포트
│   │   └── tellme.md                  #   최근 작업 브리핑 + 다음 할 일
│   ├── hooks/                         # 이벤트 기반 자동 실행 스크립트
│   │   ├── session-start.sh           #   세션 시작 → DB 초기화, 체크인 기록
│   │   ├── on-prompt.sh               #   매 턴 → 컨텍스트 주입, compaction 복구
│   │   ├── on-stop.sh                 #   세션 종료 → 세션 마감 기록
│   │   ├── post-tool-bash.sh          #   Bash 실행 후 → 에러 자동 감지
│   │   ├── post-tool-edit.sh          #   파일 편집 후 → 편집 파일 로깅
│   │   └── ralph-persist.sh           #   Ralph 모드 중단 차단
│   ├── db/                            # Context DB (SQLite)
│   │   ├── init.sql                   #   스키마 정의
│   │   └── helper.sh                  #   CLI 헬퍼 (task-add, decision-add 등)
│   └── scripts/
│       └── context-monitor.mjs        #   컨텍스트 사용률 모니터링 (독립 동작)
└── ref-docs/                          ← 참고 문서
    ├── context-db.md                  # Context DB 상세 스키마 및 사용법
    ├── context-monitor.md             # Context Monitor 동작 원리
    ├── conventions.md                 # 커밋/코드 컨벤션
    ├── setup.md                       # 새 PC 셋업 가이드
    └── CLAUDE_CODE_HANDOFF.md         # Claude Code 핸드오프 가이드
```

---

## 사용자 시나리오

### 새 프로젝트 시작

1. 새 work folder에서 프로젝트 생성 + `git init`
2. Claude Code 세션 시작
3. `/project-init` 실행 → `.claude/` 폴더 자동 생성
   - Context DB + Helper CLI
   - Hooks (세션 추적, 에러 감지, compaction 복구)
   - Commands (commit, tellme, discover, reportdb)
   - Context Monitor (HUD + statusline)
4. `CLAUDE.md`의 PROJECT 섹션을 프로젝트에 맞게 작성
5. 이후 프로젝트별 명령어/훅 추가하며 작업

### 기존 프로젝트 마이그레이션

1. 기존 프로젝트 폴더에서 Claude Code 세션 시작
2. `/project-migration` 실행
   - 기존 `.claude/` 설정 자동 백업 (`.claude/.backup-{timestamp}/`)
   - DB, Hooks, Commands, Scripts 설치 (기존 설정과 머지)
   - 기존 CLAUDE.md → COMMON + PROJECT 구조로 재구성
   - 상세 내용은 `Ref-docs/claude/`로 분리
3. PROJECT 섹션 및 분리 문서 검토
4. 기존 프로젝트 고유 hooks/commands는 그대로 보존됨

### 글로벌 설정 적용

`global/` 폴더의 파일들을 `~/.claude/`에 배치:

```bash
cp global/CLAUDE.md ~/.claude/CLAUDE.md
cp global/settings.json ~/.claude/settings.json
mkdir -p ~/.claude/commands
cp global/commands/project-init.md ~/.claude/commands/project-init.md
```

---

## 핵심 구성 요소

### 1. Agent System (글로벌 + 프로젝트)

빌트인 + 커스텀 에이전트:
- `Explore`, `Plan`, `general-purpose` — Claude Code 빌트인
- `planner` — 요청 분석 → 태스크 분해
- `architect` — 설계/아키텍처 검토 (read-only)
- `ralph` — 끈질긴 구현 (완료+검증까지 절대 중단 안 함)
- `verifier` — 빌드/테스트/타입체크 증거 기반 검증
- `reviewer` — 코드 리뷰 (보안/정확성/품질)
- `debugger` — 버그/에러 근본 원인 진단
- `test-engineer` — 테스트 전략 수립 + 테스트 코드 작성

구현 파이프라인 (`/project:implement`):
```
요청 → planner → 승인 → architect → 승인 → ralph + test-engineer → verifier → reviewer → 완료
```

### 2. Context DB (프로젝트)

SQLite 기반 세션 간 작업 추적:
- **테이블**: sessions, context, tasks, decisions, tool_usage, commits, errors, live_context
- **CLI**: `bash .claude/db/helper.sh <command>`
- Hooks가 자동으로 세션/편집/에러를 기록

### 3. Hooks (프로젝트)

Claude Code 네이티브 Hook 시스템 활용:
- 순수 bash + sqlite3 — 외부 의존성 없음
- 세션 라이프사이클 자동 추적
- Compaction 감지 + live_context 자동 복구

### 4. HUD + Context Monitor (프로젝트/글로벌)

통합 Statusline HUD:
```
[CC#1.0.80] | ~/work/project | 5h:45%(3h42m) wk:12%(2d5h) | ctx:14% | agents:3
```
- CC 버전, CWD, 세션/주간 리밋(OAuth API), ctx%, 에이전트 수
- 리밋: Anthropic OAuth API 실시간 조회 (90초 캐시)
- ctx%: 70%+ 경고, 85%+ 위험, compaction 자동 감지
- 독립 동작 (OMC 불필요)

### 5. Commands (프로젝트)

반복 작업 표준화:
- `/project:commit` — 문서 업데이트 + 기능별 커밋
- `/project:tellme` — 최근 작업 브리핑
- `/project:discover` — DB 패턴 분석 → 자동화 제안
- `/project:reportdb` — DB 현황 리포트

---

## 설계 원칙

- **OMC 비종속**: Claude Code 네이티브 기능만 사용 (Agent, Hooks, Commands)
- **순수 bash + sqlite3**: 외부 런타임 의존 최소화 (node는 context-monitor만)
- **이식성**: 어떤 프로젝트에든 `.claude/` 복사로 즉시 적용
- **점진적 확장**: 기본 템플릿 → 프로젝트별 커스텀 추가

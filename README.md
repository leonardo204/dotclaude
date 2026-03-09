# dotclaude

> Claude Code 프로젝트 스타터 킷 — 새 프로젝트에 Claude Code 개발 환경을 빠르게 구축

**Claude Code 네이티브 기능만**으로 동작합니다.
커맨드 하나(`/dotclaude-init`)로 에이전트, 훅, DB, HUD가 세팅됩니다.

---

## 이런 문제를 해결합니다

| 문제 | dotclaude의 해법 |
|------|-----------------|
| 세션이 바뀌면 이전 작업 맥락을 잊어버림 | SQLite DB + Hook이 세션/태스크/결정을 자동 기록 |
| 컨텍스트가 꽉 차면 작업 상태가 유실됨 | compaction 감지 → `live_context` 테이블에서 자동 복구 |
| "이거 구현해줘" 하면 중간에 멈추거나 대충 마무리 | Ralph 에이전트가 빌드+테스트 통과까지 끈질기게 반복 |
| 매번 같은 커밋/브리핑 작업을 수동으로 | `/project:commit`, `/project:tellme` 등 명령어로 자동화 |
| 프로젝트마다 Claude Code 설정을 처음부터 구성 | `/dotclaude-init` 한 번으로 전체 환경 세팅 |

---

## 빠른 시작

### 1. 글로벌 설정 (최초 1회)

```bash
# 이 저장소 클론
git clone https://github.com/leonardo204/dotclaude.git
cd dotclaude

# 글로벌 파일 배치
cp global/CLAUDE.md ~/.claude/CLAUDE.md
mkdir -p ~/.claude/commands ~/.claude/scripts
cp global/commands/*.md ~/.claude/commands/
cp global/scripts/context-monitor.mjs ~/.claude/scripts/
```

`~/.claude/settings.json`에 statusLine 추가 (기존 설정 유지):
```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/scripts/context-monitor.mjs",
    "padding": 2
  }
}
```

### 2. 프로젝트에 적용

```bash
# 새 프로젝트 폴더에서 Claude Code 실행 후:
/dotclaude-init        # 새 프로젝트
/dotclaude-migration   # 기존 프로젝트
```

이 명령을 실행하면 `.claude/` 폴더에 아래가 자동 생성됩니다:

```
.claude/
├── agents/      ← 7개 커스텀 에이전트
├── commands/    ← 5개 슬래시 명령어
├── hooks/       ← 6개 자동 실행 스크립트
├── db/          ← SQLite DB + CLI 도구
└── scripts/     ← HUD statusline
```

---

## 핵심 기능

### 🤖 에이전트 시스템

Claude Code는 `.claude/agents/` 폴더에 마크다운 파일을 두면 **커스텀 에이전트**를 정의할 수 있습니다.
각 에이전트는 전문 역할을 가지며, 메인 에이전트가 필요에 따라 위임합니다.

| 에이전트 | 역할 | 코드 수정 |
|----------|------|:---------:|
| **ralph** | 끈질긴 구현 — 빌드+테스트 통과까지 절대 멈추지 않음 | ✅ |
| **planner** | 요청 분석 → 태스크 분해 + 수용 기준 정의 | ❌ |
| **architect** | 설계/아키텍처 타당성 검토 | ❌ |
| **verifier** | 빌드/테스트/타입체크 증거 기반 검증 | ❌ |
| **reviewer** | 코드 리뷰 (보안, 정확성, 품질) | ❌ |
| **debugger** | 버그/에러 근본 원인 진단 | ❌ |
| **test-engineer** | 테스트 전략 수립 + 테스트 코드 작성 | ✅ |

> **Ralph란?** "포기하지 않는" 구현 에이전트입니다.
> 구현 → 빌드 → 테스트 → 실패 시 수정 → 다시 빌드... 를 모든 검증이 통과할 때까지 반복합니다.
> Stop 이벤트 Hook(`ralph-persist.sh`)이 미완료 상태에서의 중단을 차단합니다.

### 🔄 구현 파이프라인 (`/project:implement`)

복잡한 기능 구현을 자동화하는 멀티 에이전트 파이프라인입니다:

```
사용자 요청
    │
    ▼
┌─────────┐     사용자      ┌───────────┐     사용자
│ planner │ ──승인 루프──▶ │ architect │ ──승인 루프──▶ 구현 시작
└─────────┘                 └───────────┘
    계획 수립                   설계 검토

                    ┌──────────────────────┐
                    │  자동 실행 구간       │
                    │                      │
                    │  ralph + test-engineer│ ◀─┐
                    │  (구현)    (테스트)    │   │ 실패 시
                    │       │              │   │ debugger 진단 후
                    │       ▼              │   │ 재진입
                    │   verifier           │   │
                    │   (검증)             │ ──┘
                    │       │              │
                    │       ▼              │
                    │   reviewer           │
                    │   (코드 리뷰)         │
                    └──────────────────────┘
                            │
                            ▼
                    사용자 최종 확인
                    → /project:commit
```

- **Phase 1-2** (계획/설계): 사용자가 승인할 때까지 수정 반복
- **Phase 3-5** (구현/검증/리뷰): 자동 실행, 실패 시 debugger → ralph 루프
- 에이전트는 파이프라인 없이 **단독 사용**도 가능 (예: "이 버그 원인 좀 찾아줘" → debugger)

### 🪝 Hook 시스템

Claude Code의 **Hook**은 특정 이벤트(세션 시작, 파일 편집, 응답 완료 등) 발생 시 자동으로 실행되는 쉘 스크립트입니다.
`.claude/settings.json`에 등록하면 Claude Code가 해당 시점에 자동 호출합니다.

```
세션 시작 ──▶ session-start.sh ──▶ DB 초기화, 세션 기록, 미완료 태스크 표시
매 턴    ──▶ on-prompt.sh     ──▶ 컨텍스트 주입, compaction 복구
파일 편집 ──▶ post-tool-edit.sh ──▶ 편집 파일 DB 로깅
Bash 실행 ──▶ post-tool-bash.sh ──▶ 에러 자동 감지 + DB 기록
응답 완료 ──▶ on-stop.sh       ──▶ 세션 통계 갱신
응답 완료 ──▶ ralph-persist.sh ──▶ Ralph 모드 중 미완료 시 중단 차단
```

모든 Hook은 **순수 bash + sqlite3**로 동작하며, 외부 의존성이 없습니다.
DB 조회/저장 시 `[hook:*]` 형태로 사용자에게 동작을 알립니다.

### 💾 Context DB

세션 간 작업 맥락을 유지하는 **SQLite 데이터베이스**입니다.
Hook이 자동으로 데이터를 기록하고, AI가 매 턴 참조합니다.

```
┌─ sessions      세션 시작/종료 시간, 편집 파일 수
├─ tasks         할 일 목록 (우선순위, 상태)
├─ decisions     설계 결정 기록
├─ errors        에러 발생 이력 (자동 분류)
├─ tool_usage    파일 편집 로그
├─ commits       커밋 기록
└─ live_context  compaction 복구용 KV 저장소
```

CLI 도구로 직접 조회/수정도 가능합니다:

```bash
bash .claude/db/helper.sh task-add "로그인 기능 구현" 1      # 태스크 추가 (우선순위 1)
bash .claude/db/helper.sh task-list                          # 태스크 목록
bash .claude/db/helper.sh task-done 3                        # 태스크 완료
bash .claude/db/helper.sh decision-add "JWT 인증 방식 채택"   # 결정 기록
bash .claude/db/helper.sh stats                              # 전체 통계
bash .claude/db/helper.sh live-set current_task "API 구현"    # 실시간 상태 저장
```

### 📊 HUD Statusline

Claude Code 하단에 실시간 정보를 표시하는 **statusline**입니다:

```
[CC#1.0.80] | ~/work/myproject | 5h:45%(3h42m) wk:12%(2d5h) | ctx:14% | agents:3
 ─────────    ────────────────   ──────────────────────────   ───────   ────────
  CC 버전          CWD           세션 리밋     주간 리밋      컨텍스트%   에이전트 수
```

| 항목 | 데이터 소스 | 설명 |
|------|------------|------|
| CC 버전 | stdin JSON | Claude Code 버전 |
| CWD | stdin JSON | 현재 작업 디렉토리 (`~` 축약) |
| 세션/주간 리밋 | Anthropic OAuth API | 사용률 % + 리셋 잔여 시간 |
| ctx% | stdin JSON | 컨텍스트 윈도우 사용률 (70%+ 경고, 85%+ CRITICAL) |
| agents | 서브에이전트 파일 카운트 | 세션 중 사용된 에이전트 수 |

> OAuth 인증 불가 시 리밋 슬롯은 자동 생략됩니다. HUD는 에러 없이 항상 동작합니다.

### ⌨️ 커스텀 명령어

Claude Code의 **Commands**는 `.claude/commands/` 폴더에 마크다운 파일로 정의하는 슬래시 명령어입니다.
반복 작업을 표준화합니다.

| 명령어 | 설명 |
|--------|------|
| `/project:implement` | 전체 파이프라인 (계획 → 설계 → 구현 → 검증 → 리뷰) |
| `/project:commit` | 변경 분석 + 문서 업데이트 + 기능별 커밋 |
| `/project:tellme` | 최근 작업 브리핑 + 다음 할 일 제안 |
| `/project:discover` | DB 패턴 분석 → 자동화 제안 |
| `/project:reportdb` | Context DB 전체 현황 리포트 |

---

## 폴더 구조

```
dotclaude/
├── global/                            ← ~/.claude/ 에 배치하는 글로벌 설정
│   ├── CLAUDE.md                      # 글로벌 개발 가이드
│   ├── settings.json                  # statusline + 플러그인 설정
│   ├── commands/                      # 글로벌 명령어
│   │   ├── dotclaude-init.md          #   /dotclaude-init (새 프로젝트)
│   │   └── dotclaude-migration.md     #   /dotclaude-migration (기존 프로젝트)
│   ├── scripts/
│   │   └── context-monitor.mjs        #   HUD statusline 스크립트
│   └── MEMORY-example.md             # 자동 메모리 예시
│
├── project-local/                     ← 프로젝트 .claude/ 에 배치되는 템플릿
│   ├── CLAUDE.md                      # 프로젝트 가이드 (COMMON + PROJECT)
│   ├── settings.json                  # Hook 등록
│   ├── agents/                        # 커스텀 에이전트 (7개)
│   ├── commands/                      # 슬래시 명령어 (5개)
│   ├── hooks/                         # 자동 실행 스크립트 (6개)
│   ├── db/                            # Context DB 스키마 + CLI
│   └── scripts/                       # HUD 스크립트
│
└── ref-docs/                          ← 참고 문서
    ├── context-db.md                  # DB 스키마 상세
    ├── context-monitor.md             # HUD + compaction 대응 상세
    ├── conventions.md                 # 커밋/코드 컨벤션
    └── setup.md                       # 새 PC 셋업 가이드
```

---

## 사용 시나리오

### 새 프로젝트

```bash
mkdir my-app && cd my-app && git init
claude                    # Claude Code 실행
```

```
> /dotclaude-init          # .claude/ 환경 자동 생성
```

생성 후 `CLAUDE.md`의 **PROJECT 섹션**을 프로젝트에 맞게 작성하면 끝.

### 기존 프로젝트 전환

```
> /dotclaude-migration     # 기존 설정 백업 + 머지
```

- 기존 `.claude/` 설정을 `.claude/.backup-{timestamp}/`에 백업
- 기존 hooks/commands 보존하며 시스템 구성 요소 머지
- 기존 `CLAUDE.md`를 COMMON + PROJECT 구조로 재구성 (상세 내용은 문서로 분리)

### 일상 작업 흐름

```
> /project:tellme              # "어디까지 했더라?" — 최근 작업 브리핑

> /project:implement 로그인 기능 추가해줘
  # planner → architect → ralph → verifier → reviewer 자동 실행

> /project:commit              # 변경 분석 + 기능별 커밋
```

---

## 설계 원칙

| 원칙 | 설명 |
|------|------|
| **네이티브 전용** | Claude Code 네이티브 기능만 사용 (Agent, Hook, Command) |
| **순수 bash + sqlite3** | 외부 런타임 의존 최소화 (node는 HUD 스크립트만) |
| **이식성** | `.claude/` 폴더 복사만으로 어떤 프로젝트에든 적용 |
| **점진적 확장** | 기본 템플릿에서 프로젝트별 에이전트/훅/명령어 추가 |
| **안전한 머지** | 기존 설정 덮어쓰기 금지, 항상 백업 + 머지 |

---

## 요구 사항

- **Claude Code** (CLI)
- **sqlite3** (macOS/Linux 기본 내장)
- **Node.js** (HUD statusline 실행용)

---

## License

MIT

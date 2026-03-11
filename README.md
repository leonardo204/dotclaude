# dotclaude

Claude Code를 더 똑똑하게 — 에이전트, 자동 기록, 실시간 HUD를 한번에 세팅

명령어 하나(`/dotclaude-init`)로 프로젝트에 자동화된 개발 환경이 만들어집니다.

---

## 이런 문제를 해결합니다

| 문제 | dotclaude 적용 후 |
|------|------------------|
| 세션(대화창)이 바뀌면 이전 작업 맥락이 리셋됨 | 작업 내용을 DB에 자동 기록 → 다음 세션에서 자동 복구 |
| 대화가 길어지면 Claude가 편집 중이던 파일을 잊음 (compaction) | Hook이 작업 중 파일과 에러 정보를 자동 캡처해 복구 |
| 큰 기능을 요청하면 설계 없이 바로 코딩해서 엉켜버림 | planner → architect → 구현 → 검증 파이프라인 자동화 |
| Rate limit (사용량 한도) 초과 직전인지 모르고 차단됨 | HUD가 세션/주간 사용량을 실시간으로 표시 |
| 프로젝트마다 에이전트, 훅, DB를 일일이 세팅해야 함 | `/dotclaude-init` 한 번으로 전체 환경 자동 생성 |

---

## 설치

### 원라인 설치 (추천)

```bash
curl -fsSL https://raw.githubusercontent.com/leonardo204/dotclaude/main/install.sh | bash
```

기존 `~/.claude/` 설정이 있으면 `~/.claude.pre-dotclaude/`로 자동 백업됩니다.

### 수동 설치

```bash
git clone https://github.com/leonardo204/dotclaude.git
cd dotclaude && bash install.sh
```

### 프로젝트 초기화

설치 후 프로젝트 폴더에서 Claude Code를 열고 아래 명령어를 실행합니다:

```
/dotclaude-init        # 새 프로젝트 — .claude/ 환경 자동 생성
/dotclaude-update      # 기존 프로젝트 — 최신 업데이트 적용
```

---

## 주요 기능

### 🤖 자동 에이전트 시스템

7개의 전문 에이전트가 역할을 나눠 복잡한 작업을 처리합니다.

| 에이전트 | 역할 | 코드 수정 |
|----------|------|:---------:|
| **ralph** | 끈질긴 구현 — 빌드+테스트 통과까지 절대 멈추지 않음 | 가능 |
| **planner** | 요청 분석 → 태스크 분해 + 수용 기준 정의 | 불가 |
| **architect** | 설계 및 아키텍처 타당성 검토 | 불가 |
| **verifier** | 빌드/테스트/타입체크 결과 기반 검증 | 불가 |
| **reviewer** | 코드 리뷰 (보안, 정확성, 품질) | 불가 |
| **debugger** | 버그/에러 근본 원인 진단 | 불가 |
| **test-engineer** | 테스트 전략 수립 + 테스트 코드 작성 | 가능 |

**Ralph 에이전트**: 빌드 에러가 나면 고치고, 테스트가 실패하면 수정하고, 완료 조건이 충족될 때까지 반복합니다. "대략 동작합니다"를 허용하지 않습니다.

**구현 파이프라인**: "로그인 기능 추가해줘"처럼 규모 있는 요청을 받으면 에이전트들이 순서대로 자동 협업합니다.

```
planner (계획) → architect (설계) → ralph + test-engineer (구현/테스트) → verifier (검증) → reviewer (리뷰)
```

계획과 설계 단계에서는 사용자 승인을 받고, 구현부터 리뷰까지는 자동으로 실행됩니다.

**MCP 팀 모드**: 여러 에이전트가 Context DB를 통해 실시간으로 정보를 공유합니다. `team_dispatch`로 워커 에이전트에게 태스크를 전달하고, `team_context`로 중간 결과를 공유합니다. 별도 설정 없이 기본 활성화되어 있습니다.

**자동 트리거**: 파일 3개 이상 수정, 5단계 이상 작업, 아키텍처 변경이 감지되면 CLAUDE.md 지침에 따라 적절한 에이전트가 자동으로 선택됩니다.

---

### 🛡️ 컨텍스트 보호 (Compaction 대응)

Claude Code는 대화가 길어지면 이전 내용을 압축(compaction)합니다. 이때 편집 중이던 파일 경로나 직전 에러 정보를 잊어버려 작업이 끊기는 문제가 생깁니다.

dotclaude는 Hook을 통해 핵심 상태를 자동으로 DB에 기록하고, compaction 이후에도 작업 흐름이 이어지도록 합니다.

**자동 캡처 항목**

| 항목 | 캡처 시점 | 내용 |
|------|-----------|------|
| `working_files` | 컨텍스트 70% 도달 시 | 편집 중인 파일 경로 (최대 20개) |
| `error_context` | 에러 발생 시 | 에러 유형 + 관련 파일 경로 |
| `session_summary` | 세션 종료 시 | 이번 세션 편집 파일 수 + 목록 |
| `_rules` | 세션 시작 시 | CLAUDE.md 핵심 지침 |
| `current_task` | 수동 저장 | 현재 진행 중인 작업 설명 |

**3단계 차등 주입**: 매 턴마다 컨텍스트 사용률을 확인해 상황에 맞게 정보를 주입합니다.

- 기본 (70% 미만): 세션 요약만 표시
- 경고 (70~90%): working_files, error_context 추가 주입
- 복구 (compaction 감지): DB에서 전체 상태를 불러와 자동 복구

---

### 📊 HUD (실시간 상태 표시줄)

Claude Code 하단에 현재 사용량과 환경 정보를 실시간으로 표시합니다.

```
[CC#1.0.80] | ~/work/myproject | 5h:39%(2h37m) wk:15%(4d7h) | Opus | ctx:14% | agents:3
 ─────────    ────────────────   ────────────────────────────   ────   ───────   ────────
  CC 버전          작업 경로      세션 사용량     주간 사용량    모델    맥락%   활성 에이전트
```

| 항목 | 설명 |
|------|------|
| CC 버전 | 현재 Claude Code 버전 |
| 작업 경로 | 현재 디렉토리 |
| 세션 사용량 | 이번 세션에서 소모한 Rate limit 비율 + 남은 시간 |
| 주간 사용량 | 이번 주 누적 사용량 비율 |
| 모델 | 현재 사용 중인 Claude 모델 |
| 맥락% | 현재 대화 컨텍스트 사용률 |
| 활성 에이전트 | 현재 실행 중인 서브에이전트 수 |

Rate limit 정보는 백그라운드에서 주기적으로 갱신되어 API 블로킹이 없습니다. HUD 표시 자체는 로컬 캐시만 읽으므로 응답 속도에 영향을 주지 않습니다.

---

### ⚡ 커스텀 명령어

**프로젝트 명령어** (프로젝트 내에서 사용):

| 명령어 | 설명 |
|--------|------|
| `/project:dotclaude-help` | 명령어 및 에이전트 목록 표시 |
| `/project:dotclaude-implement` | 전체 파이프라인 (계획 → 설계 → 구현 → 검증 → 리뷰) 실행 |
| `/project:dotclaude-commit` | 변경 분석 + 문서 업데이트 + 기능별 커밋 |
| `/project:dotclaude-tellme` | 최근 작업 브리핑 + 다음 할 일 제안 |
| `/project:dotclaude-discover` | DB 패턴 분석 → 자동화 제안 |
| `/project:dotclaude-reportdb` | Context DB 전체 현황 리포트 |

**글로벌 명령어** (모든 프로젝트에서 사용):

| 명령어 | 설명 |
|--------|------|
| `/dotclaude-init` | 프로젝트에 dotclaude 환경 초기화 |
| `/dotclaude-update` | dotclaude 시스템 파일 최신 업데이트 |

**사용 예시**:

```
# 기능 구현 요청 — 파이프라인이 자동으로 계획부터 리뷰까지 처리
/project:dotclaude-implement
> 사용자 인증 기능을 JWT 방식으로 구현해줘

# 오늘 작업 현황 확인
/project:dotclaude-tellme
```

---

## 요구 사항

- **Claude Code** (CLI)
- **Node.js 22 이상** (내장 SQLite 모듈 사용)
- **sqlite3** (CLI 도구 — 없으면 install.sh가 자동 설치)

---

## 제거

```bash
# 로컬 실행 (확인 프롬프트 표시)
bash uninstall.sh

# 원격 실행
curl -fsSL https://raw.githubusercontent.com/leonardo204/dotclaude/main/uninstall.sh | bash -s -- -y
```

dotclaude가 설치한 파일만 삭제하며, 사용자가 추가한 파일은 보존됩니다.

---

## License

MIT

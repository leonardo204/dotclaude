---
description: "dotclaude 시스템 도움말 — 명령어 및 에이전트 목록 표시"
---

dotclaude 시스템 도움말을 출력합니다.

아래 내용을 사용자에게 보여주세요:

## dotclaude 명령어

| 명령어 | 설명 |
|--------|------|
| `/project:dotclaude-help` | 명령어 및 에이전트 목록 표시 |
| `/project:dotclaude-implement` | 계획 → 설계 → 구현 → 검증 → 리뷰 파이프라인 실행 |
| `/project:dotclaude-commit` | 변경 사항 분석 → 문서 업데이트 → 기능별 커밋 → 푸시 |
| `/project:dotclaude-tellme` | 최근 작업 브리핑 + 다음 할 일 제안 |
| `/project:dotclaude-discover` | Context DB 패턴 분석 → 자동화 가능한 패턴 발견 |
| `/project:dotclaude-reportdb` | Context DB 전체 현황 리포트 |

## dotclaude 글로벌 명령어

| 명령어 | 설명 |
|--------|------|
| `/dotclaude-init` | 프로젝트에 dotclaude 환경 초기화 |
| `/dotclaude-update` | dotclaude 시스템 파일 최신 업데이트 |

## dotclaude 에이전트

| 에이전트 | 설명 |
|----------|------|
| `planner` | 요청 분석 → 태스크 분해 + 수용 기준 정의 |
| `architect` | 설계/구현 검토 + 아키텍처 타당성 검증 |
| `ralph` | 끈질긴 구현 — 빌드/테스트 통과까지 절대 멈추지 않음 |
| `test-engineer` | 테스트 전략 수립 + 테스트 코드 작성 |
| `verifier` | 빌드/테스트/타입체크 증거 기반 검증 |
| `debugger` | 버그/에러 근본 원인 진단 |
| `reviewer` | 코드 리뷰 — 보안/정확성/품질 검토 |

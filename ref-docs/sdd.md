# SDD 스펙 문서 — 스펙 주도 개발 최소 공통 가이드라인

> 이 문서는 dotclaude 하니스가 제공하는 **최소 공통 규약**이다. SDD에 절대 표준은 없으므로,
> 과도한 강제 대신 "영향도 추적이 가능한 최소 골격"만 정한다. 프로젝트별로 확장하라.

## 위치 & 소유권

| 폴더 | 소유 | 규칙 |
|------|------|------|
| `{DOC_ROOT}/claude/` | dotclaude 하니스 | 🔒 읽기 전용. `dotclaude-update`가 덮어쓴다. 수정 금지 |
| `{DOC_ROOT}/specs/` | 프로젝트(사용자) | 📝 스펙 문서를 여기에 둔다 |

- 스펙 문서는 반드시 `specs/` 아래 둔다 — 하니스 문서와 섞지 않는다.
- `{DOC_ROOT}`는 프로젝트의 문서 루트(`docs/`, `ref-docs/` 등 init 시 감지/선택).

## 문서 계층 (의존 흐름)

```
요구/설계 → 구현계획 → 인터페이스·메시지 스펙 → 테스트계획
```

| 종류 | 위치 | 답하는 질문 |
|------|------|-----------|
| 설계서 (design) | `specs/design/` | 무엇을·왜·어떤 구조로 |
| 구현계획서 (impl) | `specs/impl/` | 어떤 순서로·무슨 태스크·수용 기준 |
| 인터페이스/메시지 스펙 (interface) | `specs/interface/` | API·이벤트·메시지 형식·계약 |
| 테스트계획서 (test) | `specs/test/` | 무엇을 어떻게 검증 |

## frontmatter 규약 (필수)

모든 스펙 문서는 아래 frontmatter로 시작한다. **영향도 추적의 근간**이다.

```yaml
---
id: <kebab-id>            # 고유 식별자 (파일명과 일치 권장)
title: <제목>
type: design | impl | interface | test
version: 0.1.0            # semver — 내용 변경 시 bump
status: draft | review | approved | superseded
scope: <한 줄 — 이 문서가 다루는 범위>
related: [<id>, ...]      # 참조/의존하는 문서 id (경로 아님)
supersedes: <id>         # 대체하는 이전 문서 (있으면)
updated: YYYY-MM-DD
---
```

## 작성 규칙 (최소)

1. **단일 책임**: 한 문서 = 한 `scope`. scope를 벗어나면 문서를 분리한다.
2. **상호참조는 id로**: 경로가 아니라 `related`의 id로 연결 → 파일이 이동해도 그래프가 유지되고 영향도 추적이 가능하다.
3. **버전 bump**: 내용 변경 시 `version` + `updated` 갱신. 방향이 바뀌는 큰 전환은 새 문서 + `supersedes`로 이전 문서를 가리키고, 이전 문서 `status: superseded`.
4. **범위 균형** (과설계/과소 둘 다 경계):
   - **over-architecting**: 현 요구에 없는 미래 대비·과한 추상화 → 제거하거나 `backlog`로 분리.
   - **under-estimate**: 수용 기준·엣지 케이스·실패 경로·비기능 요구 누락 → 보강.
   - **무시/누락**: design에 있는데 impl/test로 내려오지 않은 항목.
5. **개수 적절성**: 한 문서가 여러 scope를 담으면 분리, 지나치게 잘게 쪼개졌으면 통합.

## 영향도 추적

- 문서를 추가/수정할 때 `related`로 연결된 문서들이 영향받는지 확인한다.
- **`spec-guard` skill**이 `specs/` 전체의 frontmatter 그래프를 분석해
  영향도 맵·중복/관련도·범위 적합성(over/under)·누락·문서 개수·버전 정합을 리포트한다 (read-only, 권고만).
- 발동: 스펙 문서를 작성/수정/검토할 때뿐 아니라, **계획·설계 리포트를 md로 저장한 직후**, **외부에서 작성된 스펙을 `specs/`·`ref-docs`에 복사·추가할 때**(저장·복사 행위 자체가 스펙 작성), 또는 `/spec-guard` 명시 호출. 외부 복사본은 frontmatter가 없는 경우가 많으니 규약에 맞춰 보강을 먼저 권고받는다.

→ 관련: [Agent Delegation](agent-delegation.md) (구현 파이프라인은 승인된 스펙을 입력으로 받는다)

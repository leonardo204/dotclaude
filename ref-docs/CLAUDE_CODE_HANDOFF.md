# Wandery 프로젝트 - Claude Code 핸드오프 문서

## 프로젝트 개요

**Wandery**는 여행 사진을 분석하여 자동으로 타임라인과 스토리를 생성하는 iOS 앱입니다.

### 핵심 아키텍처 결정사항 (v2.0)
- **서버리스 앱**: 로그인/회원가입 없음
- **BYOK (Bring Your Own Key)**: 사용자가 직접 AI API 키 입력 (유일한 AI 연동 방식)
- **3탭 네비게이션**: 홈, 기록, 설정 (프로필 탭 없음)
- **프리미엄 기능 없음**: 모든 기능 무료, 크레딧 구매 없음

---

## 문서 목록

| 파일명 | 설명 | 용도 |
|--------|------|------|
| `wander_planning_report.md` | 기획 보고서 v2.0 | 앱 전체 기획, 비즈니스 모델, 기술 스택 정의 |
| `wander_ui_scenario.md` | UI 시나리오 명세서 v2.0 | 화면별 상세 동작, 플로우, 예외 처리 정의 |
| `wander_design_concept.md` | 디자인 컨셉 가이드 | 브랜드 아이덴티티, 컬러, 타이포그래피 |
| `wander_ai_prompts.md` | AI 프롬프트 v1.0 (원본) | Google Stitch용 UI 생성 프롬프트 (참고용) |
| `wander_ai_prompts2.md` | AI 프롬프트 v2.0 (수정본) | **현재 사용해야 할 프롬프트** - FIX/NEW 프롬프트 포함 |

---

## google-stitch 폴더 현황

`google-stitch/` 폴더에는 Google Stitch로 생성한 UI 스크린샷이 있습니다.

### 정상 화면 (13개) ✅
다음 화면들은 수정 없이 사용 가능:
- `splash_screen` - 스플래시
- `onboarding_screen_1`, `_2`, `_3` - 온보딩 시퀀스
- `photo_selection_screen` - 사진 선택
- `date_range_selection` - 날짜 범위 선택
- `analyzing_photos_screen` - 분석 중 로딩
- `analysis_result_full_journey` - 분석 결과
- `map_detail_screen` - 지도 상세
- `ai_story_generation_screen` - AI 스토리 생성
- `share_options_sheet` - 공유 옵션
- `export_progress_screen` - 내보내기 진행
- `permission_request_photo` - 권한 요청

### ⚠️ 수정 필요 화면 (6개)

| 파일명 | 문제점 |
|--------|--------|
| `home_screen_empty_state` | ❌ 4개 영문 탭 (Home, Map, Records, Profile)<br>❌ 헤더에 프로필 아이콘 |
| `wander_home_screen` | ❌ 탭바 구조 문제 |
| `wander_records_library` | ❌ 탭바 구조 문제 |
| `wander_settings_screen` | ❌ 계정 섹션 (이름/이메일 표시)<br>❌ 프리미엄 뱃지<br>❌ 로그아웃 버튼<br>❌ 4개 잘못된 탭 (탐색, 저장, 채팅, 설정) |
| `wander_ai_provider_settings` | ❌ 크레딧 구매 섹션 (₩1,500, ₩4,400, ₩11,000)<br>❌ "잔여 크레딧: 0" 표시 |
| `wander_general_error_screen` | ❌ 5개 완전히 잘못된 탭 (홈, 검색, 예약, 찜, 프로필) |

---

## 왜 ai_prompts2.md를 사용해야 하는가?

### 1. v1.0 프롬프트의 한계
- 초기 프롬프트(v1.0)는 프리미엄/로그인 기능이 포함된 버전 기준
- Google Stitch가 일부 화면에서 잘못된 탭바 구조 생성
- 영문 UI, 4-5개 탭 등 일관성 없는 결과물

### 2. v2.0 프롬프트의 개선점
```
✅ 명확한 제약조건 명시 (PROMPT 0 Design System)
✅ 3탭 구조 강제 (홈, 기록, 설정)
✅ 한국어 UI 텍스트 요구
✅ 프리미엄/로그인 UI 명시적 제외
✅ ASCII 목업으로 정확한 레이아웃 가이드
✅ FIX 프롬프트: 기존 화면 수정용
✅ NEW 프롬프트: 누락 화면 생성용
```

### 3. 작업 순서 권장
1. **PROMPT 0** (Design System v2.0) 먼저 입력 - 필수
2. **FIX 프롬프트** 순서대로 실행 (FIX-01 → FIX-06)
3. **NEW 프롬프트** 실행 (NEW-01 → NEW-04)
4. 각 화면 생성 후 **Verification Checklist** 확인

---

## Claude Code 작업 가이드

### 다음 작업 (우선순위순)

**Phase 1: UI 수정** (Google Stitch 사용)
```
1. FIX-01: Home Screen Empty State
2. FIX-04: Settings Screen
3. FIX-05: AI Provider Settings
4. FIX-06: General Error Screen
5. FIX-02: Home Screen (With Records)
6. FIX-03: Records Library Screen
```

**Phase 2: 누락 화면 생성** (Google Stitch 사용)
```
1. NEW-01: API Key Input Screen (SCR-020)
2. NEW-03: Timeline Edit Mode (SCR-012)
3. NEW-02: Data Management Screen (SCR-021)
4. NEW-04: Export Options Sheet (SCR-015)
```

**Phase 3: 실제 구현** (추후)
- React Native 또는 Swift UI 코드 작성
- 위 프롬프트 결과물을 참고하여 구현

### 검증 체크리스트 (각 화면마다 확인)
- [ ] 탭바가 정확히 3개 (홈, 기록, 설정)
- [ ] 탭 라벨이 한국어
- [ ] 헤더에 프로필 아이콘 없음
- [ ] 프리미엄/다이아몬드 뱃지 없음
- [ ] 크레딧 구매 UI 없음
- [ ] 로그아웃 버튼 없음
- [ ] 모든 UI 텍스트 한국어
- [ ] Primary 색상 #87CEEB

---

## 디자인 시스템 요약

### 색상
- Primary: `#87CEEB` (Pastel Sky Blue)
- Background: `#FFFFFF`
- Surface: `#F8FBFD`
- Text Primary: `#1A2B33`
- Text Secondary: `#5A6B73`

### 탭바 스펙
```
┌─────────────────────────────────────────┐
│   🏠          📚          ⚙️           │
│   홈          기록        설정          │
└─────────────────────────────────────────┘
```
- 높이: 49pt + 34pt safe area = 83pt
- Active: #87CEEB
- Inactive: #8A9BA3
- 배경: #F8FBFD
- 상단 보더: 0.5pt #E5EEF2

### 뷰포트
- iPhone 14 기준: 390 x 844

---

## 참고 링크

- **Google Stitch**: https://stitch.withgoogle.com/
- **Firebase Studio**: https://firebase.google.com/

---

*문서 작성일: 2026-01-30*
*작성자: Claude (Cowork Mode)*

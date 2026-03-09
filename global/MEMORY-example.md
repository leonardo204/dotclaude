# Wander Project Memory

## 프로젝트 핵심 정보
- iOS 17+ SwiftUI + SwiftData 여행 사진 분석 앱 (MVVM)
- **App Store 출시 완료** (2026-02-28): Wandery
- App Store: https://apps.apple.com/kr/app/wandery/id6759185541
- 홈페이지: https://wander.zerolive.co.kr
- `cd src && xcodegen generate` 후 빌드
- SourceKit 크로스파일 참조 오류는 무시 가능 (xcodegen 빌드 시 해결)

## 문서 구조 (2026-02-28 리팩토링)
- `CLAUDE.md` (~100줄): 프로젝트 요약 + 핵심 규칙 + 상세/UI 시나리오 문서 링크
- `Ref-docs/claude/`: 8개 상세 문서 (features, design-system, conventions 등)
- `Ref-Concepts/ui-scenarios/`: UI 시나리오 명세 (20+ 파일, 탭별 분리)
- UI 변경 시 반드시 해당 시나리오 문서도 함께 업데이트 (CLAUDE.md에 명시됨)

## AI 서비스 (현재 상태)
- 내장 API Key 전용: GoogleAIService + Secrets.plist (gemini-2.5-flash)
- Google OAuth / BYOK 프로바이더 모두 v4.0에서 제거됨
- 일일 3회 제한 (AIUsageManager, UserDefaults, 자정 리셋)
- 리워드 광고로 3회 추가 가능 (일 최대 3회)

## AI 다듬기 기능
- 파일: `AIEnhancementModels.swift`, `AIEnhancementService.swift`
- TravelDNA.description은 computed property → `aiEnhancedDNADescription` 오버레이 필드 사용
- 모든 스마트 분석 구조체 필드는 `let` → 머지 시 새 인스턴스 생성 필요
- 멀티모달: Gemini에 대표 사진 전송 (320×320, JPEG 0.6, 최대 8장)

## 데이터 구조 주의사항
- `TravelStory`, `StoryChapter`: 모두 let, Codable
- `TravelInsight`: let + relatedData(var), 커스텀 init 있음

## 디자인 토큰
- 반드시 `WanderColors`, `WanderTypography`, `WanderSpacing` 사용
- 하드코딩 금지 (systemGray6 → WanderColors.surface 등)
- UI에 이모지 금지 → SF Symbol 사용

## Worker (Cloudflare)
- wander-share-worker: 홈페이지/개인정보/이용약관/AASA/app-ads.txt/게시판
- 도메인: wander.zerolive.co.kr
- App Store URL 상수: index.ts 상단 APP_STORE_URL
- 랜딩 페이지: `/` (이전 `/next`, 루트로 이전됨)
- 게시판: `/board` + `/api/board/posts` (D1 wander-board, APAC)
- 관리자 비밀번호: `ADMIN_PASSWORD` wrangler secret
- 모든 페이지 공통 nav/footer (Pretendard, KO/EN 토글)
- 배포: `cd wander-share-worker/dawn-band-946e && npx wrangler deploy`

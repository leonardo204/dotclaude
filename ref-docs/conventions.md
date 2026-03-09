← [CLAUDE.md로 돌아가기](../../CLAUDE.md)

# 컨벤션

## 커밋 컨벤션

```
[타입] 간단한 설명

타입:
- [Init] 초기 설정
- [Feature] 새 기능
- [UI] UI 작업
- [Fix] 버그 수정
- [Refactor] 리팩토링
- [Docs] 문서
```

---

## 주석 컨벤션 (LLM 친화적)

코드 주석은 **다음 수정 시 Claude가 빠르게 이해할 수 있도록** 작성합니다.

### 주석 원칙
1. **WHY 중심**: 무엇을 하는지보다 **왜** 그렇게 하는지 설명
2. **Context 제공**: 관련 파일, 연동 포인트, 의존성 명시
3. **Edge Case 설명**: 특이 케이스나 주의사항 기록
4. **TODO 명확화**: 미완성 부분은 `// TODO:` 로 명시

### 주석 패턴

```swift
// MARK: - 섹션명 (파일 구조 파악용)

/// 함수/변수 설명 (DocString 형식)
/// - Parameter name: 파라미터 설명
/// - Returns: 반환값 설명

// NOTE: 특별한 설계 결정 이유 설명
// 예: "sheet(item:) 사용 - isPresented 방식은 타이밍 이슈 발생"

// IMPORTANT: 수정 시 주의사항
// 예: "이 값 변경 시 CustomTabBar.swift도 함께 수정 필요"

// TODO: 미구현 또는 개선 필요 사항
// 예: "// TODO: 오프라인 모드 지원 추가"

// FIXME: 알려진 버그 또는 임시 해결책
// 예: "// FIXME: iOS 18에서 간헐적 크래시 - 원인 조사 필요"

// 연동 포인트 표시
// Related: ContentView.swift (탭 상태), CustomTabBar.swift (UI)
```

### 복잡한 로직 주석 예시

```swift
/// 탭 선택 처리
/// - 같은 탭 재선택 시: 해당 탭의 루트 뷰로 리셋
/// - 다른 탭 선택 시: 해당 탭으로 전환
/// - Related: CustomTabBar.swift (탭바 UI), HomeView.swift (홈 탭 상태)
func selectTab(_ tab: TabItem) {
    if selectedTab == tab {
        // NOTE: 같은 탭 재클릭 = 초기 상태로 리셋
        // 각 탭의 NavigationStack path를 초기화해야 함
        resetTabToRoot(tab)
    } else {
        selectedTab = tab
    }
}
```

---

## 로깅 컨벤션

```swift
import os.log
private let logger = Logger(subsystem: "com.zerolive.wander", category: "CategoryName")

// 이모지 컨벤션
🚀 앱 시작    🏠 홈 화면    📷 사진 관련    📍 위치/클러스터링
🗺️ 지도      🔬 분석      ✨ AI 스토리    ⚙️ 설정
✅ 성공      ❌ 에러      ⚠️ 경고        💾 저장
```

# Source Playbook — 축별로 어디를 뒤질까

SKILL.md의 STEP 3 스윕을 돌 때 참고하는 소스 지도.
검색어는 항상 **STEP 2에서 잡은 분야 용어**로 구체화한다. 아래는 "그 분야를 넣어 조합할 틀"이다.

## 목차
1. 글로벌 표준/트렌드
2. 국내 표준/트렌드
3. 선두 기업/조직 → 스택 파헤치기
4. 커뮤니티
5. 뉴스
6. GitHub
7. 일반 웹
8. 공식 문서

---

## 1. 글로벌 표준 / 트렌드
- `<분야> best practices`, `<분야> state of the art 2026`, `<분야> reference architecture`
- 표준화 기구/컨소시엄 자료(W3C, IETF, ISO, IEEE, OWASP, NIST 등 해당 시)
- 업계 애널리스트/서베이: Gartner, ThoughtWorks Technology Radar, Stack Overflow Developer Survey, State of JS/AI 등
- 대표 벤더의 whitepaper·엔지니어링 블로그

## 2. 국내 표준 / 트렌드 (한국어로 검색)
- `<분야> 국내 사례`, `<분야> 트렌드 2026`, `<분야> 도입`
- 국내 기업 기술블로그: 우아한형제들(우아한테크), 토스(토스테크), 카카오, 네이버(D2/네이버클라우드), 라인, 당근, 쿠팡, 뱅크샐러드, 요기요 등
- 국내 미디어/커뮤니티: 요즘IT(yozm.wishket), GeekNews(news.hada.io), 브런치, 벨로그(velog), 티스토리 기술글
- 정부/기관(해당 시): NIA, TTA, KISA, 각 부처 가이드라인·표준

## 3. 선두 기업/조직 → 스택 파헤치기
2단계로 판다. **가능하면 3개 조직까지** 뽑아 같은 기준으로 비교한다.
1) **누가 리더인가**: `<분야> leading companies`, `<분야> market leaders`, `who does <분야> best` → 상위 3곳 선정
2) **각 조직이 뭘 쓰나**: `<회사> engineering blog <분야>`, `<회사> tech stack <기술>`, `<회사> how we built`
- 3곳을 표로 비교: 채택 기술/프레임워크 · 아키텍처·workflow · BM · 강점/차이
- 3곳 공통 = 업계 관행(안전한 기본값), 갈리는 부분 = 선택지
- 소스: 각 사 engineering blog, 컨퍼런스 발표(YouTube/slides), 채용공고(스택 힌트), case study

## 4. 커뮤니티
- Hacker News (`site:news.ycombinator.com <주제>`), Reddit 관련 서브레딧, Lobsters
- dev.to, Medium, Substack의 실무자 글
- 분야별 전용: (ML) Papers with Code·Hugging Face 포럼, (프론트) 관련 Discord/포럼, (교육/이러닝) 관련 협회·커뮤니티
- 국내: GeekNews 댓글, 요즘IT, 오픈채팅/커뮤니티 정리글
- 실무 논의(지연·비용·함정 같은 "실전 이슈")를 특히 캐낸다

## 5. 뉴스
- `<주제> 2026`, `<제품> release`, `<분야> announcement`
- 최근 것 우선. 빠르게 변하는 주제는 최근 1개월 소스 우대
- 1차 출처(회사 공식 발표, 릴리스 노트) > 애그리게이터

## 6. GitHub
- `<기술> github`, `awesome <분야>`, `<태스크> library`
- 판단 기준: stars 규모, 최근 커밋/릴리스 활발도, 이슈 대응, 사실상의 표준 여부
- "awesome-<분야>" 큐레이션 리스트가 지도로 유용
- 라이선스도 확인(상업화 가능 여부)

## 7. 일반 웹 (google web search)
- 위 축에서 안 잡힌 갭을 메우는 용도
- 비교글("X vs Y"), 튜토리얼, 벤치마크, 후기

## 8. 공식 문서 (해당되는 벤더만) — **우선순위 최상 · 1차 출처**
- 스윕 순서상 뒤에 있지만 **가장 권위 있는 출처**다. 관련 벤더가 있으면 반드시 확인하고 다른 축과 충돌 시 이쪽을 기준으로 삼는다.
- Anthropic: docs.claude.com / anthropic.com
- OpenAI: platform.openai.com/docs
- Microsoft/Azure: learn.microsoft.com
- Google/GCP: cloud.google.com/docs, ai.google.dev
- AWS: docs.aws.amazon.com
- Meta: 관련 프로젝트 docs(예: PyTorch, Llama)
- Apple: developer.apple.com/documentation
- 그 외 해당 분야 핵심 벤더의 공식 docs (검색 결과에 등장한 URL만 web_fetch)

---

## 팁
- 한 검색이 여러 축을 커버하면 중복하지 않는다.
- 각 축은 "이 분야에 실제로 존재하는 것"만 남긴다. 억지로 채우지 말 것.
- 국내/글로벌 결과가 다르면 그 차이 자체가 인사이트다 — 리포트에 대비시켜 적는다.

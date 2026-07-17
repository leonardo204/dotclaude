/**
 * 테스트 전용 모듈 해석 훅 — 상대 경로 ".js" 스펙파이어를 ".ts"로 폴백한다.
 *
 * 왜 필요한가:
 *   src는 TypeScript 관례대로 상대 임포트에 ".js" 확장자를 쓴다 (bridge.ts 등).
 *   esbuild(빌드)와 tsc(타입체크)는 둘 다 .js → .ts로 해석해 준다.
 *   그런데 node의 타입 스트리핑은 이 재작성을 하지 않는다 (v24 실측).
 *   테스트는 src/**.ts를 node로 직접 로드하므로, src 간 **값** 임포트가
 *   ERR_MODULE_NOT_FOUND로 죽는다. (기존 src 간 임포트는 전부 type-only라
 *   런타임에 지워져 이 문제가 드러나지 않았다.)
 *
 * 대안은 src에서만 ".ts" 확장자를 쓰는 것인데, 그러면 저장소에 두 관례가 섞인다.
 * 한계는 테스트 하니스 쪽에 있으므로 여기서 흡수한다.
 */

import { register } from 'node:module';

register('./ts-resolve-hooks.mjs', import.meta.url);

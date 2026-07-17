/**
 * resolve 훅 본체 — ts-resolve.mjs가 register()로 로드한다.
 * esbuild/tsc와 동일한 TypeScript 스타일 확장자 해석을 node에 부여한다.
 */

/**
 * 상대 경로 "./x.js"가 실제로 없으면 "./x.ts"로 다시 시도한다.
 * 그 외 스펙파이어는 건드리지 않는다 (node: 빌트인, 패키지 등).
 */
export async function resolve(specifier, context, nextResolve) {
  const isRelativeJs = /^\.{1,2}\//.test(specifier) && specifier.endsWith('.js');
  if (!isRelativeJs) return nextResolve(specifier, context);

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    return nextResolve(`${specifier.slice(0, -'.js'.length)}.ts`, context);
  }
}

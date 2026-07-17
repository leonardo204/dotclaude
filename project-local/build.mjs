#!/usr/bin/env node
/**
 * esbuild 빌드 스크립트
 * 진입점들을 번들링하여 dist/ 에 출력
 */

import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const baseOptions = {
  platform: 'node',
  format: 'esm',
  bundle: true,
  external: [
    'node:*',
  ],
};

const entryPoints = [
  { in: 'src/hooks/bridge.ts', out: 'dist/hooks/bridge' },
  { in: 'src/hud/statusline.ts', out: 'dist/hud/statusline' },
  { in: 'src/hud/fetcher.ts', out: 'dist/hud/fetcher' },
  { in: 'src/hud/cost.ts', out: 'dist/hud/cost' },
  { in: 'src/messenger/cli.ts', out: 'dist/messenger/cli' },
];

if (isWatch) {
  const ctxs = await Promise.all(
    entryPoints.map(({ in: entryPoint, out: outfile }) =>
      esbuild.context({
        ...baseOptions,
        entryPoints: [entryPoint],
        outfile: `${outfile}.js`,
      })
    )
  );

  await Promise.all(ctxs.map((ctx) => ctx.watch()));
  console.log('[build] watching for changes...');
} else {
  await Promise.all(
    entryPoints.map(({ in: entryPoint, out: outfile }) =>
      esbuild.build({
        ...baseOptions,
        entryPoints: [entryPoint],
        outfile: `${outfile}.js`,
      })
    )
  );
  console.log(
    `[build] done → ${entryPoints.map(({ out }) => `${out}.js`).join(', ')}`
  );
}

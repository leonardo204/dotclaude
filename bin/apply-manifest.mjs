#!/usr/bin/env node
/**
 * apply-manifest.mjs — dotclaude 배포 로직 단일 구현
 *
 * install.sh / dotclaude-update / uninstall.sh 가 전부 이 스크립트를 호출한다.
 * 배포 대상은 repo 루트의 manifest.json 하나로 정의된다 (하드코딩 복사목록 제거).
 *
 * 사용법:
 *   node apply-manifest.mjs --scope <global|local> --src <repo루트> --dest <설치루트> [--force] [--dry-run]
 *   node apply-manifest.mjs --uninstall --dest <설치루트> --manifest <설치된manifest경로>
 *
 * 설계 하드제약 (architect must-fix):
 *  1. 스탬프는 항상 마지막. 복사가 전부 성공한 뒤에만 SHA 스탬프를 쓴다.
 *     중간 실패 시 스탬프 부재 → 다음 실행이 전량 재적용(멱등).
 *  2. dist 는 recursive 복사 — 하위목록 열거 금지 (messenger 파손 재발 방지).
 *  3. 원자성: 복사 루프에서 하나라도 throw 하면 스탬프 미기록 상태로 exit 1.
 *     node 라 실행 순서가 코드로 보장된다.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// ─── 인자 파싱 ───
function parseArgs(argv) {
  const args = { force: false, dryRun: false, uninstall: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--scope': args.scope = argv[++i]; break;
      case '--src': args.src = argv[++i]; break;
      case '--dest': args.dest = argv[++i]; break;
      case '--manifest': args.manifest = argv[++i]; break;
      case '--force': args.force = true; break;
      case '--dry-run': args.dryRun = true; break;
      case '--uninstall': args.uninstall = true; break;
      default:
        throw new Error(`알 수 없는 인자: ${a}`);
    }
  }
  return args;
}

// ─── 로깅: 사람용 로그는 stderr, 최종 JSON 결과만 stdout ───
function log(msg) { process.stderr.write(`${msg}\n`); }
function emit(obj) { process.stdout.write(`${JSON.stringify(obj)}\n`); }

// ─── 해시 유틸 ───
function sha256String(str) {
  return createHash('sha256').update(str).digest('hex');
}
function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
/** 재귀 디렉토리를 결정적으로 해시 (상대경로 정렬 + 파일해시 연결). */
function treeHash(dir) {
  const files = listFilesRec(dir).sort();
  const h = createHash('sha256');
  for (const f of files) {
    h.update(relative(dir, f));
    h.update('\0');
    h.update(readFileSync(f));
    h.update('\0');
  }
  return h.digest('hex');
}
/** deployed_sha256: 단일 파일이면 파일해시, 디렉토리면 tree 해시. */
function deployedSha(path) {
  return statSync(path).isDirectory() ? treeHash(path) : sha256File(path);
}

// ─── 파일시스템 유틸 ───
function listFilesRec(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFilesRec(p));
    else out.push(p);
  }
  return out;
}
function isDirEmpty(dir) {
  return listFilesRec(dir).length === 0;
}
function ensureDir(dir, dryRun) {
  if (!dryRun) mkdirSync(dir, { recursive: true });
}
function copyFileEnsure(src, dest, dryRun) {
  if (dryRun) return;
  ensureDir(dirname(dest), false);
  writeFileSync(dest, readFileSync(src));
}
/** 오버레이 복사: src 트리를 dest 로 복사하되 목록에 없는 dest 파일은 보존. */
function copyDirOverlay(src, dest, dryRun) {
  for (const f of listFilesRec(src)) {
    const rel = relative(src, f);
    copyFileEnsure(f, join(dest, rel), dryRun);
  }
}

// ─── manifest 로드 ───
function loadManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ─── repoSHA 계산: git HEAD, 실패 시 manifest+VERSION 내용 해시 폴백 ───
function computeRepoSha(src, manifestPath) {
  try {
    const sha = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (sha) return sha;
  } catch { /* git 없음/비-repo → 폴백 */ }
  const manifestContent = readFileSync(manifestPath, 'utf8');
  const versionPath = join(src, 'VERSION');
  const versionContent = existsSync(versionPath) ? readFileSync(versionPath, 'utf8') : '';
  return sha256String(`${manifestContent}\n---VERSION---\n${versionContent}`);
}

// ─── 스탬프 읽기 ───
function readGlobalStamp(dest) {
  const p = join(dest, '.dotclaude-installed');
  if (!existsSync(p)) return null;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^applied_sha=(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}
function readLocalStamp(dest) {
  const p = join(dest, '.dotclaude-version');
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8').trim();
}

// ─── 스탬프 쓰기 (must-fix 1: 항상 마지막) ───
function writeGlobalStamp(dest, repoSha, version) {
  const p = join(dest, '.dotclaude-installed');
  const lines = existsSync(p) ? readFileSync(p, 'utf8').split('\n') : [];
  const kv = new Map();
  const order = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const k = line.slice(0, idx);
    if (!kv.has(k)) order.push(k);
    kv.set(k, line.slice(idx + 1));
  }
  const upsert = (k, v) => { if (!kv.has(k)) order.push(k); kv.set(k, v); };
  upsert('applied_sha', repoSha);
  if (version) upsert('version', version); // 하드코딩 1.0.0 교체
  const out = order.map((k) => `${k}=${kv.get(k)}`).join('\n') + '\n';
  writeFileSync(p, out);
}
function writeLocalStamp(dest, repoSha) {
  writeFileSync(join(dest, '.dotclaude-version'), `${repoSha}\n`);
}

// ─── 엔트리 적용 ───
function applyEntry(entry, ctx) {
  const { src, dest, dryRun, installedManifest } = ctx;
  const srcPath = join(src, entry.src);
  const destPath = join(dest, entry.dest);
  const isRecursive = entry.recursive === true;

  // required / 존재 검증
  const srcExists = existsSync(srcPath);
  if (!srcExists || (isRecursive && srcExists && isDirEmpty(srcPath))) {
    if (entry.required === true) {
      throw new Error(
        `[required] 엔트리 '${entry.id}' 의 src 가 없거나 비었습니다: ${entry.src}` +
        (isRecursive ? ' (재귀 디렉토리 비어있음 — 빌드 누락 의심)' : '')
      );
    }
    log(`[warn] 엔트리 '${entry.id}' src 없음 → skip: ${entry.src}`);
    return { status: 'skipped', id: entry.id };
  }

  const policy = entry.policy;
  let result;
  if (policy === 'merge-hooks') {
    result = applyMergeHooks(entry, srcPath, destPath, dest, dryRun);
  } else if (policy === 'replace-if-unmodified') {
    result = applyReplaceIfUnmodified(entry, srcPath, destPath, installedManifest, dryRun);
  } else if (policy === 'replace') {
    if (isRecursive) {
      ensureDir(destPath, dryRun);
      copyDirOverlay(srcPath, destPath, dryRun);
    } else {
      copyFileEnsure(srcPath, destPath, dryRun);
    }
    result = { status: 'applied', id: entry.id };
  } else {
    throw new Error(`알 수 없는 policy '${policy}' (엔트리 ${entry.id})`);
  }

  // sentinel 검증 (복사 후) — dry-run 은 실제 복사가 없으므로 src 기준으로 체크
  if (Array.isArray(entry.sentinels)) {
    for (const s of entry.sentinels) {
      const checkBase = dryRun ? srcPath : destPath;
      if (!existsSync(join(checkBase, s))) {
        throw new Error(
          `[sentinel] 엔트리 '${entry.id}' 배포 후 필수 파일 누락: ${s}` +
          ' (빌드 산출물이 비어있거나 조용한 no-op 발생)'
        );
      }
    }
  }

  // deployed_sha256 기록
  if (result.status === 'applied') {
    result.deployedSha = dryRun
      ? (existsSync(destPath) ? deployedSha(destPath) : deployedSha(srcPath))
      : deployedSha(destPath);
  } else if (result.status === 'preserved') {
    // 보존 시 기존 추적값 유지
    result.deployedSha = result.deployedSha;
  }
  return result;
}

function applyMergeHooks(entry, srcPath, destPath, destRoot, dryRun) {
  const src = JSON.parse(readFileSync(srcPath, 'utf8'));
  const cur = existsSync(destPath) ? JSON.parse(readFileSync(destPath, 'utf8')) : {};
  cur.hooks = src.hooks;
  const hudDisabled = existsSync(join(destRoot, '.hud_disabled'));
  if (src.statusLine && !cur.statusLine && !hudDisabled) {
    cur.statusLine = src.statusLine;
  }
  if (!dryRun) {
    ensureDir(dirname(destPath), false);
    writeFileSync(destPath, JSON.stringify(cur, null, 2) + '\n');
  }
  return { status: 'applied', id: entry.id };
}

function applyReplaceIfUnmodified(entry, srcPath, destPath, installedManifest, dryRun) {
  const prevSha = installedManifest?.entries?.find((e) => e.id === entry.id)?.deployed_sha256;
  const destExists = existsSync(destPath);

  // 최초(기록 없음) 또는 dest 없음 → 교체
  if (prevSha === undefined || !destExists) {
    copyFileEnsure(srcPath, destPath, dryRun);
    return { status: 'applied', id: entry.id };
  }
  const curSha = sha256File(destPath);
  if (curSha === prevSha) {
    // 사용자 미수정 → 교체
    copyFileEnsure(srcPath, destPath, dryRun);
    return { status: 'applied', id: entry.id };
  }
  // 사용자 수정 → 보존 + 경고, 기존 추적값 유지
  log(`[preserve] 엔트리 '${entry.id}' 사용자 수정 감지 → 보존 (repo 버전 미적용): ${entry.dest}`);
  return { status: 'preserved', id: entry.id, deployedSha: prevSha };
}

// ─── apply 모드 ───
function runApply(args) {
  const { scope, src, dest, force, dryRun } = args;
  if (!scope || !src || !dest) {
    throw new Error('--scope, --src, --dest 는 필수입니다.');
  }
  if (scope !== 'global' && scope !== 'local') {
    throw new Error(`--scope 는 global|local 이어야 합니다: ${scope}`);
  }

  const manifestPath = join(src, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json 을 찾을 수 없습니다: ${manifestPath}`);
  }
  const manifest = loadManifest(manifestPath);
  const repoSha = computeRepoSha(src, manifestPath);

  // 스탬프 게이팅 (dry-run 은 항상 분석 — up-to-date skip 우회)
  const currentStamp = scope === 'global' ? readGlobalStamp(dest) : readLocalStamp(dest);
  if (currentStamp === repoSha && !force && !dryRun) {
    emit({ skipped: true, reason: 'up-to-date', scope, sha: repoSha });
    return 0;
  }

  // 설치된 resolved manifest (replace-if-unmodified 판단용)
  const installedManifestPath = join(dest, '.dotclaude-manifest.json');
  const installedManifest = existsSync(installedManifestPath)
    ? loadManifest(installedManifestPath)
    : null;

  ensureDir(dest, dryRun);

  const entries = manifest.entries.filter(
    (e) => e.scope === scope || e.scope === 'both'
  );

  const applied = [];
  const skipped = [];
  const preserved = [];
  const shaByEntry = new Map();

  // ─── 복사 루프 (must-fix 3 원자성: throw 시 스탬프 미기록) ───
  for (const entry of entries) {
    const r = applyEntry(entry, { src, dest, dryRun, installedManifest });
    if (r.status === 'applied') { applied.push(r.id); if (r.deployedSha) shaByEntry.set(r.id, r.deployedSha); }
    else if (r.status === 'skipped') skipped.push(r.id);
    else if (r.status === 'preserved') { preserved.push(r.id); if (r.deployedSha) shaByEntry.set(r.id, r.deployedSha); }
  }

  // ─── 전부 성공 후: resolved manifest → 스탬프 (반드시 이 순서) ───
  if (!dryRun) {
    const resolved = JSON.parse(JSON.stringify(manifest));
    for (const e of resolved.entries) {
      if (shaByEntry.has(e.id)) e.deployed_sha256 = shaByEntry.get(e.id);
      else if (installedManifest) {
        // 이번 scope 에서 처리 안 한 엔트리는 기존 기록 보존
        const prev = installedManifest.entries?.find((x) => x.id === e.id);
        if (prev?.deployed_sha256) e.deployed_sha256 = prev.deployed_sha256;
      }
    }
    resolved.applied_sha = repoSha;
    writeFileSync(installedManifestPath, JSON.stringify(resolved, null, 2) + '\n');

    // 스탬프 — 항상 마지막
    if (scope === 'global') {
      const versionPath = join(src, 'VERSION');
      const version = existsSync(versionPath) ? readFileSync(versionPath, 'utf8').trim() : '';
      writeGlobalStamp(dest, repoSha, version);
    } else {
      writeLocalStamp(dest, repoSha);
    }
  }

  emit({ scope, applied, skipped, preserved, sha: repoSha, dryRun: dryRun || undefined });
  return 0;
}

// ─── uninstall 모드 ───
function runUninstall(args) {
  const { dest, manifest: manifestPath } = args;
  if (!dest || !manifestPath) {
    throw new Error('--uninstall 모드는 --dest 와 --manifest 가 필요합니다.');
  }
  if (!existsSync(manifestPath)) {
    throw new Error(`설치된 manifest 를 찾을 수 없습니다: ${manifestPath}`);
  }
  const manifest = loadManifest(manifestPath);
  const removed = [];
  const notFound = [];

  const del = (p) => {
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      log(`[removed] ${p}`);
      removed.push(p);
    } else {
      log(`[skip] 없음: ${p}`);
      notFound.push(p);
    }
  };

  // harness 소유 + global/both 엔트리의 dest 삭제
  for (const e of manifest.entries || []) {
    if (e.ownership === 'harness' && (e.scope === 'global' || e.scope === 'both')) {
      del(join(dest, e.dest));
    }
  }
  // runtime_artifacts (global) 삭제
  for (const a of manifest.runtime_artifacts || []) {
    if (a.scope === 'global') del(join(dest, a.path));
  }

  emit({ uninstall: true, removed, notFound });
  return 0;
}

// ─── main ───
function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    log(`[error] ${e.message}`);
    process.exit(2);
  }
  try {
    const code = args.uninstall ? runUninstall(args) : runApply(args);
    process.exit(code);
  } catch (e) {
    log(`[error] ${e.message}`);
    process.exit(1);
  }
}

main();

/**
 * OAuth token acquisition — shared by fetcher.ts (and bridge.ts if needed)
 * macOS Keychain → .credentials.json → credentials.json 순서로 토큰 획득
 * refresh도 지원 (fetcher 전용, 비동기 OK)
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

export const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

export interface OAuthCredential {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractOAuth(entry: any): OAuthCredential | null {
  const oauth = entry.claudeAiOauth || entry.oauthAccount || entry;
  if (oauth?.accessToken) {
    return {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken ?? null,
      expiresAt: oauth.expiresAt ?? null,
    };
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeBackCredentials(tokenData: any): void {
  const credPath = join(homedir(), ".claude", ".credentials.json");
  try {
    if (!existsSync(credPath)) return;
    const creds = JSON.parse(readFileSync(credPath, "utf8"));
    const entries = Array.isArray(creds) ? creds : [creds];
    for (const entry of entries) {
      const target = entry.claudeAiOauth || entry.oauthAccount || entry;
      if (target?.accessToken) {
        target.accessToken = tokenData.access_token;
        if (tokenData.refresh_token) target.refreshToken = tokenData.refresh_token;
        if (tokenData.expires_in) {
          target.expiresAt = Date.now() + tokenData.expires_in * 1000;
        }
        break;
      }
    }
    // atomic write: 임시 파일에 쓴 뒤 rename
    const tmpPath = join(tmpdir(), `credentials-${randomBytes(6).toString("hex")}.json`);
    writeFileSync(tmpPath, JSON.stringify(creds, null, 2));
    renameSync(tmpPath, credPath);
  } catch {
    // ignore
  }
}

/**
 * OAuth 토큰을 새로 발급받는다 (백그라운드 fetcher 전용).
 * Node.js 내장 fetch() 사용 — shell injection 방지.
 */
export async function refreshOAuthToken(refreshToken: string): Promise<string | null> {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
    });
    const res = await fetch("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(5000),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    if (data.access_token) {
      writeBackCredentials(data);
      return data.access_token as string;
    }
  } catch {
    // ignore
  }
  return null;
}

// 폴링마다 소스를 다시 읽으면 (키체인 ACL 미승인 시) macOS GUI 프롬프트가 폭주하므로,
// 획득한 토큰을 프로세스 메모리에 캐시한다(만료 또는 최대 TTL 중 이른 시점까지).
// fetcher 는 15분 주기 외에 매 프롬프트마다 SIGUSR1 로 즉시 조회를 받으므로
// (쿨다운 60초), 캐시가 없으면 활성 세션에서 60초마다 security 가 호출된다.
let cachedToken: { value: string; expiresAt: number } | null = null;
const MAX_CACHE_MS = 5 * 60 * 1000; // 만료 정보가 없거나 멀 때의 캐시 상한
const MIN_CACHE_MS = 15 * 1000; // 최소 재조회 간격(폴링 하드닝)

// 키체인 조회가 실패하면(ACL 미승인 → GUI 대기 → execSync timeout) 한동안 다시
// 시도하지 않는다. 실패 경로에는 캐시할 토큰이 없어 위 캐시만으로는 막히지 않는다
// — 프롬프트 폭주와 security 프로세스 누적이 바로 이 경로에서 생긴다.
let keychainBlockedUntil = 0;
const KEYCHAIN_BACKOFF_MS = 15 * 60 * 1000;

/**
 * OAuth 액세스 토큰을 획득한다.
 * 순서: (캐시) → macOS Keychain → .credentials.json → credentials.json
 * 토큰 만료 시 refresh 시도 (refreshToken 있을 때만).
 *
 * 키체인은 Claude Code 가 토큰을 갱신하는 원본이므로 순서를 유지한다. 대신
 * 조회 결과를 캐시하고, 실패 시 backoff 를 걸어 GUI 프롬프트 폭주를 막는다.
 * 키체인 접근을 아예 끄려면 환경변수 DOTCLAUDE_DISABLE_KEYCHAIN=1 (opt-out).
 *
 * 주의: execSync(security) 사용 — fetcher(백그라운드) 또는 statusline.ts 외부에서만 호출.
 */
export async function getOAuthToken(): Promise<string | null> {
  // 0. 캐시 — 폴링마다 소스를 재조회하지 않는다(키체인 프롬프트 폭주 방지).
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  let oauth: OAuthCredential | null = null;

  // 1. macOS Keychain (opt-out: DOTCLAUDE_DISABLE_KEYCHAIN=1, 실패 시 backoff)
  if (
    process.platform === "darwin" &&
    process.env.DOTCLAUDE_DISABLE_KEYCHAIN !== "1" &&
    Date.now() >= keychainBlockedUntil
  ) {
    try {
      const raw = execSync(
        'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: "utf8", timeout: 3000 }
      ).trim();
      const creds = JSON.parse(raw);
      const entries = Array.isArray(creds) ? creds : [creds];
      for (const entry of entries) {
        oauth = extractOAuth(entry);
        if (oauth) break;
      }
    } catch {
      // 타임아웃(GUI 대기) 또는 항목 없음 — 당분간 재시도하지 않는다
      keychainBlockedUntil = Date.now() + KEYCHAIN_BACKOFF_MS;
    }
  }

  // 2. File-based credentials
  if (!oauth) {
    const credPaths = [
      join(homedir(), ".claude", ".credentials.json"),
      join(homedir(), ".claude", "credentials.json"),
    ];
    for (const p of credPaths) {
      try {
        if (!existsSync(p)) continue;
        const raw = readFileSync(p, "utf8").trim();
        if (!raw) continue;
        const creds = JSON.parse(raw);
        const entries = Array.isArray(creds) ? creds : [creds];
        for (const entry of entries) {
          oauth = extractOAuth(entry);
          if (oauth) break;
        }
        if (oauth) break;
      } catch {
        // ignore
      }
    }
  }

  if (!oauth) return null;

  // 만료 시 refresh
  let token = oauth.accessToken;
  let ttl = MAX_CACHE_MS;
  if (oauth.expiresAt && oauth.expiresAt <= Date.now() && oauth.refreshToken) {
    const newToken = await refreshOAuthToken(oauth.refreshToken);
    // refresh 실패 시 만료된 토큰을 오래 붙들지 않는다(다음 주기에 재시도)
    if (newToken) token = newToken;
    else ttl = MIN_CACHE_MS;
  } else if (oauth.expiresAt) {
    ttl = Math.min(Math.max(oauth.expiresAt - Date.now(), 0), MAX_CACHE_MS);
  }

  cachedToken = { value: token, expiresAt: Date.now() + Math.max(ttl, MIN_CACHE_MS) };
  return token;
}

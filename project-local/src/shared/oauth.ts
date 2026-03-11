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

/**
 * OAuth 액세스 토큰을 획득한다.
 * 순서: macOS Keychain → .credentials.json → credentials.json
 * 토큰 만료 시 refresh 시도 (refreshToken 있을 때만)
 *
 * 주의: execSync(security) 사용 — fetcher(백그라운드) 또는 statusline.ts 외부에서만 호출.
 */
export async function getOAuthToken(): Promise<string | null> {
  let oauth: OAuthCredential | null = null;

  // 1. macOS Keychain
  if (process.platform === "darwin") {
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
      // ignore
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
        const creds = JSON.parse(readFileSync(p, "utf8"));
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
  if (oauth.expiresAt && oauth.expiresAt <= Date.now() && oauth.refreshToken) {
    const newToken = await refreshOAuthToken(oauth.refreshToken);
    if (newToken) return newToken;
  }

  return oauth.accessToken;
}

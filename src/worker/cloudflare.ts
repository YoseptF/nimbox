export const CF_AUTHORIZE = "https://dash.cloudflare.com/oauth2/auth";
export const CF_TOKEN = "https://dash.cloudflare.com/oauth2/token";
export const CF_REVOKE = "https://dash.cloudflare.com/oauth2/revoke";
export const CF_API = "https://api.cloudflare.com/client/v4";

export const CF_SCOPES = [
  "workers-scripts.admin",
  "workers-r2.write",
  "dns.write",
  "zone.read",
  "zone-settings.write",
  "access.write",
  "access.revoke",
  "email-routing-address.write",
  "email-routing-rule.write",
  "offline_access",
];

export interface CloudflareLink {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  accountId: string;
  accountName: string;
  scriptName: string;
  scriptTag: string;
  hostname: string;
}

export class CfError extends Error {
  constructor(public status: number, message: string, public code?: number) {
    super(message);
  }
}

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(length = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(length)));
}

export async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string, challenge: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: CF_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${CF_AUTHORIZE}?${params}`;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
}

async function tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(CF_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof data.access_token !== "string") {
    throw new CfError(response.status, String(data.error_description ?? data.error ?? "Cloudflare did not accept the sign-in"));
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : null,
  };
}

export function exchangeCode(clientId: string, redirectUri: string, code: string, verifier: string) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier });
}

export function refreshAccessToken(clientId: string, refreshToken: string) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
}

export async function revokeToken(clientId: string, token: string) {
  await fetch(CF_REVOKE, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, client_id: clientId }),
  }).catch(() => null);
}

export async function cfApi<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${CF_API}${path}`, { ...init, headers });
  const data = (await response.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { code?: number; message?: string }[] };
  if (!response.ok || data.success === false) {
    const first = data.errors?.[0];
    throw new CfError(response.status, first?.message ?? `Cloudflare returned ${response.status}`, first?.code);
  }
  return data.result as T;
}

export async function findWorkerByVersion(token: string, hostname: string, versionId: string) {
  if (!versionId) return null;
  const firstLabel = hostname.split(".")[0];
  const accounts = await cfApi<{ id: string; name: string }[]>(token, "/accounts?per_page=50");
  for (const account of accounts) {
    const scripts = await cfApi<{ id: string; tag?: string }[]>(token, `/accounts/${account.id}/workers/scripts`);
    const ordered = [...scripts.filter((s) => s.id === firstLabel), ...scripts.filter((s) => s.id !== firstLabel)].slice(0, 25);
    for (const script of ordered) {
      if (!script.tag) continue;
      const versions = await cfApi<{ items?: { id: string }[] }>(
        token,
        `/accounts/${account.id}/workers/scripts/${encodeURIComponent(script.id)}/versions?per_page=20`,
      ).catch(() => ({ items: [] }));
      if (versions.items?.some((v) => v.id === versionId)) {
        return { accountId: account.id, accountName: account.name, scriptName: script.id, scriptTag: script.tag };
      }
    }
  }
  return null;
}

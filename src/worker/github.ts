const API = "https://api.github.com";
const USER_AGENT = "nimbox-updater";

export class GithubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  refreshExpiresAt: number | null;
}

export type TokenResult = { ok: true; token: TokenSet } | { ok: false; error: string; interval?: number };

async function oauth(params: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(`https://github.com/login/oauth/access_token?${new URLSearchParams(params)}`, {
    method: "POST",
    headers: { accept: "application/json", "user-agent": USER_AGENT },
  });
  if (!response.ok) throw new GithubError(response.status, `GitHub sign-in failed (${response.status})`);
  return response.json();
}

function toTokenSet(data: Record<string, unknown>, now: number): TokenSet {
  return {
    accessToken: String(data.access_token),
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresAt: typeof data.expires_in === "number" ? now + data.expires_in * 1000 : null,
    refreshExpiresAt: typeof data.refresh_token_expires_in === "number" ? now + data.refresh_token_expires_in * 1000 : null,
  };
}

export async function startDeviceFlow(clientId: string) {
  const response = await fetch(`https://github.com/login/device/code?${new URLSearchParams({ client_id: clientId })}`, {
    method: "POST",
    headers: { accept: "application/json", "user-agent": USER_AGENT },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof data.device_code !== "string") {
    throw new GithubError(response.status, String(data.error_description ?? data.error ?? "GitHub did not return a code"));
  }
  return {
    deviceCode: data.device_code,
    userCode: String(data.user_code),
    verificationUri: String(data.verification_uri ?? "https://github.com/login/device"),
    expiresIn: Number(data.expires_in ?? 900),
    interval: Number(data.interval ?? 5),
  };
}

export async function pollDeviceFlow(clientId: string, deviceCode: string, now = Date.now()): Promise<TokenResult> {
  const data = await oauth({ client_id: clientId, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
  if (typeof data.access_token === "string") return { ok: true, token: toTokenSet(data, now) };
  return { ok: false, error: String(data.error ?? "unknown_error"), interval: typeof data.interval === "number" ? data.interval : undefined };
}

export async function refreshToken(clientId: string, refresh: string, now = Date.now()): Promise<TokenResult> {
  const data = await oauth({ client_id: clientId, grant_type: "refresh_token", refresh_token: refresh });
  if (typeof data.access_token === "string") return { ok: true, token: toTokenSet(data, now) };
  return { ok: false, error: String(data.error ?? "unknown_error") };
}

export async function github<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/vnd.github+json");
  headers.set("user-agent", USER_AGENT);
  headers.set("x-github-api-version", "2022-11-28");
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(path.startsWith("http") ? path : `${API}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new GithubError(response.status, body.message ?? `GitHub returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function githubBytes(path: string, token: string | null) {
  const headers: Record<string, string> = { "user-agent": USER_AGENT, "x-github-api-version": "2022-11-28" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(path.startsWith("http") ? path : `${API}${path}`, { headers });
  if (!response.ok) throw new GithubError(response.status, `Could not download the release (${response.status})`);
  return response.arrayBuffer();
}

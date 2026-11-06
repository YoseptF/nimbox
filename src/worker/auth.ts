import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv } from "./env";

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function teamOrigin(domain: string) {
  let host = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!host.includes(".")) host = `${host}.cloudflareaccess.com`;
  return `https://${host}`;
}

export function accessSecretsSet(env: AppEnv) {
  return Boolean(env.ACCESS_TEAM_DOMAIN?.trim() && env.ACCESS_AUD?.trim());
}

export function devBypass(request: Request, env: AppEnv) {
  const host = new URL(request.url).hostname;
  return env.DEV_ACCESS_BYPASS === "1" && (host === "localhost" || host === "127.0.0.1");
}

async function fromAccessContext(ctx: ExecutionContext | undefined, wantEmail: boolean) {
  const access = ctx?.access;
  if (!access) return null;
  let email = "";
  if (wantEmail) {
    try {
      const identity = await access.getIdentity();
      email = typeof identity?.email === "string" ? identity.email : "";
    } catch {}
  }
  return { email };
}

export async function authenticate(
  request: Request,
  env: AppEnv,
  ctx?: ExecutionContext,
  wantEmail = false,
): Promise<{ email: string } | null> {
  if (devBypass(request, env)) return { email: "dev@localhost" };
  const viaAccess = await fromAccessContext(ctx, wantEmail);
  if (viaAccess) return viaAccess;
  if (!accessSecretsSet(env)) return null;
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  const issuer = teamOrigin(env.ACCESS_TEAM_DOMAIN!);
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    keySets.set(issuer, keys);
  }
  try {
    const { payload } = await jwtVerify(token, keys, { issuer, audience: env.ACCESS_AUD!.trim() });
    return { email: typeof payload.email === "string" ? payload.email : "" };
  } catch {
    return null;
  }
}

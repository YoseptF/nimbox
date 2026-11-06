import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker/index";
import type { AppEnv } from "../src/worker/env";
import { appEnv } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const TEAM = "https://acme.cloudflareaccess.com";
const AUD = "test-aud";

function call(env: AppEnv, path: string, headers: Record<string, string> = {}, ctx?: Partial<ExecutionContext>) {
  return worker.fetch!(new Request(`https://nimbox.acme.workers.dev${path}`, { headers }) as never, env, ctx as ExecutionContext);
}

function signedIn(email: string): Partial<ExecutionContext> {
  return { access: { aud: "app-aud", getIdentity: async () => ({ email }) as never } } as Partial<ExecutionContext>;
}

const keyPair = generateKeyPair("RS256");

async function signer() {
  const { publicKey, privateKey } = await keyPair;
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === `${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    return realFetch(input, init);
  });
  return (aud: string) =>
    new SignJWT({ email: "owner@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(TEAM)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
}

describe("access", () => {
  const configured = { ...appEnv, DEV_ACCESS_BYPASS: undefined, ACCESS_TEAM_DOMAIN: "acme", ACCESS_AUD: AUD } as AppEnv;

  it("keeps the API closed when Access is not set up", async () => {
    const env = { ...appEnv, DEV_ACCESS_BYPASS: undefined } as AppEnv;
    expect((await call(env, "/api/mailboxes")).status).toBe(401);
    expect(await (await call(env, "/api/status")).json()).toMatchObject({ authenticated: false });
  });

  it("ignores the dev bypass outside localhost", async () => {
    expect((await call(appEnv, "/api/mailboxes")).status).toBe(401);
  });

  it("rejects requests without a valid Access token", async () => {
    const sign = await signer();
    expect((await call(configured, "/api/mailboxes")).status).toBe(401);
    const wrong = await sign("another-app");
    expect((await call(configured, "/api/mailboxes", { "cf-access-jwt-assertion": wrong })).status).toBe(401);
  });

  it("accepts a valid Access token", async () => {
    const sign = await signer();
    const token = await sign(AUD);
    const response = await call(configured, "/api/mailboxes", { "cf-access-jwt-assertion": token });
    expect(response.status).toBe(200);
    const status = await (await call(configured, "/api/status", { "cf-access-jwt-assertion": token })).json();
    expect(status).toMatchObject({ authenticated: true, email: "owner@example.com" });
  });

  it("trusts the sign-in Cloudflare Access hands to the Worker, with no settings to copy", async () => {
    const env = { ...appEnv, DEV_ACCESS_BYPASS: undefined } as AppEnv;
    expect((await call(env, "/api/mailboxes", {}, signedIn("owner@example.com"))).status).toBe(200);
    const status = await (await call(env, "/api/status", {}, signedIn("owner@example.com"))).json();
    expect(status).toMatchObject({ authenticated: true, email: "owner@example.com" });
  });

  it("ignores a forged token header when Access did not sign the request in", async () => {
    const env = { ...appEnv, DEV_ACCESS_BYPASS: undefined } as AppEnv;
    const forged = "eyJhbGciOiJub25lIn0.eyJhdWQiOiJ4IiwiZW1haWwiOiJ4QHgifQ.";
    expect((await call(env, "/api/mailboxes", { "cf-access-jwt-assertion": forged })).status).toBe(401);
  });
});

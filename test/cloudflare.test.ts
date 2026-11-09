import { afterEach, describe, expect, it, vi } from "vitest";
import { pkceChallenge } from "../src/worker/cloudflare";
import { CLOUDFLARE_REDIRECT_URI } from "../src/worker/release";
import { api, appEnv } from "./helpers";

afterEach(() => vi.restoreAllMocks());

interface Call {
  method: string;
  url: URL;
  body: unknown;
}

function fakeCloudflare(options: { ownVersion?: boolean; routingEnabled?: boolean; rulesFail?: boolean } = {}) {
  const state = {
    routingEnabled: options.routingEnabled ?? false,
    dns: [
      { id: "mx1", type: "MX", name: "mail.example", content: "mx1.improvmx.com", priority: 10 },
      { id: "spf", type: "TXT", name: "mail.example", content: '"v=spf1 include:spf.improvmx.com ~all"' },
      { id: "site", type: "TXT", name: "mail.example", content: '"google-site-verification=abc"' },
    ] as { id: string; type: string; name: string; content: string; priority?: number }[],
    rules: [] as { id: string; enabled: boolean; matchers: unknown[]; actions: unknown[] }[],
    apps: [] as Record<string, unknown>[],
    tokenForms: [] as URLSearchParams[],
    revoked: [] as string[],
  };
  const calls: Call[] = [];
  const realFetch = globalThis.fetch;
  const ok = (result: unknown) => Response.json({ success: true, result });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    if (url.hostname !== "dash.cloudflare.com" && url.hostname !== "api.cloudflare.com") return realFetch(input, init);
    const raw = init?.body ? String(init.body) : "";
    const body = raw.startsWith("{") ? JSON.parse(raw) : raw;
    calls.push({ method, url, body });
    const path = url.pathname.replace("/client/v4", "");
    if (url.pathname === "/oauth2/token") {
      const form = new URLSearchParams(raw);
      state.tokenForms.push(form);
      return Response.json({ access_token: `cf-access-${state.tokenForms.length}`, refresh_token: "cf-refresh", expires_in: 3600 });
    }
    if (url.pathname === "/oauth2/revoke") {
      state.revoked.push(new URLSearchParams(raw).get("token") ?? "");
      return new Response(null, { status: 200 });
    }
    if (path === "/accounts") return ok([{ id: "acc1", name: "Example account" }]);
    if (path === "/accounts/acc1/workers/scripts" && method === "GET") return ok([{ id: "other", tag: "tag999" }, { id: "nimbox", tag: "tag123" }]);
    if (path === "/accounts/acc1/workers/scripts/other/versions") return ok({ items: [{ id: "someone-elses-version" }] });
    if (path === "/accounts/acc1/workers/scripts/nimbox/versions") {
      return ok({ items: [{ id: options.ownVersion === false ? "unrelated-version" : appEnv.CF_VERSION_METADATA!.id }] });
    }
    if (path === "/accounts/acc1/workers/scripts/nimbox/settings") return ok({ bindings: [{ type: "r2_bucket", name: "MAIL", bucket_name: "my-mail" }] });
    if (path === "/accounts/acc1/r2/buckets/my-mail" && method === "DELETE") return ok(null);
    if (path === "/accounts/acc1/workers/scripts/nimbox" && method === "DELETE") return ok(null);
    if (path === "/accounts/acc1/access/apps" && method === "GET") return ok(state.apps);
    if (path === "/accounts/acc1/access/apps" && method === "POST") {
      const app = { id: "app1", ...(body as object) };
      state.apps.push(app);
      return ok(app);
    }
    if (path === "/accounts/acc1/access/apps/app1" && method === "GET") return ok({ ...state.apps[0], aud: "x", created_at: "t" });
    if (path === "/accounts/acc1/access/apps/app1" && method === "PUT") {
      state.apps[0] = { ...(body as object), id: "app1" };
      return ok(state.apps[0]);
    }
    if (path === "/accounts/acc1/access/apps/app1" && method === "DELETE") {
      state.apps = [];
      return ok(null);
    }
    if (path === "/zones") return ok(url.searchParams.get("name") === "mail.example" ? [{ id: "zone1", name: "mail.example" }] : []);
    if (path === "/zones/zone1/email/routing") return ok({ enabled: state.routingEnabled });
    if (path === "/zones/zone1/email/routing/dns" && method === "POST") {
      state.routingEnabled = true;
      return ok({});
    }
    if (path === "/zones/zone1/dns_records" && method === "GET") {
      const name = url.searchParams.get("name");
      const type = url.searchParams.get("type");
      return ok(state.dns.filter((r) => (!name || r.name === name) && (!type || r.type === type)));
    }
    if (path === "/zones/zone1/dns_records" && method === "POST") {
      const record = { id: `r${state.dns.length + 1}`, ...(body as { type: string; name: string; content: string }) };
      state.dns.push(record);
      return ok(record);
    }
    if (path.startsWith("/zones/zone1/dns_records/") && method === "DELETE") {
      state.dns = state.dns.filter((r) => r.id !== path.split("/").pop());
      return ok(null);
    }
    if (path === "/zones/zone1/email/routing/rules" && method === "GET") return ok(state.rules);
    if (path === "/zones/zone1/email/routing/rules" && method === "POST" && options.rulesFail) {
      return Response.json({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }, { status: 403 });
    }
    if (path === "/zones/zone1/email/routing/rules" && method === "POST") {
      const rule = { id: `rule${state.rules.length + 1}`, ...(body as { enabled: boolean; matchers: unknown[]; actions: unknown[] }) };
      state.rules.push(rule);
      return ok(rule);
    }
    if (path.startsWith("/zones/zone1/email/routing/rules/") && method === "DELETE") {
      state.rules = state.rules.filter((r) => r.id !== path.split("/").pop());
      return ok(null);
    }
    return Response.json({ success: false, errors: [{ code: 7003, message: `No route for ${method} ${path}` }] }, { status: 404 });
  });
  return { state, calls };
}

async function connect() {
  const start = await api("/api/cloudflare/connect", { redirect: "manual" });
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get("location")!);
  const state = authorize.searchParams.get("state")!;
  const callback = await api(`/api/cloudflare/callback?code=code123&state=${encodeURIComponent(state)}`);
  return { authorize, callback };
}

describe("connecting Cloudflare", () => {
  it("sends people to Cloudflare's consent screen with PKCE and no secret", async () => {
    fakeCloudflare();
    const start = await api("/api/cloudflare/connect");
    const location = new URL(start.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://dash.cloudflare.com/oauth2/auth");
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "cf-test-client",
      redirect_uri: CLOUDFLARE_REDIRECT_URI,
      code_challenge_method: "S256",
    });
    expect(location.searchParams.get("state")).toMatch(/~localhost$/);
    expect(location.searchParams.get("scope")!.split(" ").sort()).toEqual(
      [
        "access.revoke",
        "access.write",
        "dns.write",
        "email-routing-address.write",
        "email-routing-rule.write",
        "offline_access",
        "workers-r2.write",
        "workers-scripts.admin",
        "zone-settings.write",
        "zone.read",
      ].sort(),
    );
  });

  it("keeps the connection only when the account runs this nimbox", async () => {
    const { state } = fakeCloudflare();
    await api("/api/cloudflare", { method: "DELETE", body: "{}" });
    const { authorize, callback } = await connect();
    expect(callback.headers.get("location")).toBe("/?cloudflare=connected");
    const form = state.tokenForms[0];
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("client_secret")).toBeNull();
    expect(await pkceChallenge(form.get("code_verifier")!)).toBe(authorize.searchParams.get("code_challenge"));
    expect(await (await api("/api/cloudflare")).json()).toEqual({
      enabled: true,
      connected: true,
      lapsed: false,
      accountName: "Example account",
      workerName: "nimbox",
    });
  });

  it("refuses an account that doesn't run this nimbox", async () => {
    const { state } = fakeCloudflare({ ownVersion: false });
    await api("/api/cloudflare", { method: "DELETE", body: "{}" });
    const { callback } = await connect();
    expect(callback.headers.get("location")).toBe("/?cloudflare=wrong-account");
    expect(state.revoked.at(-1)).toBe("cf-access-1");
    expect(await (await api("/api/cloudflare")).json()).toMatchObject({ connected: false });
  });

  it("ignores a callback that was meant for another nimbox or reused", async () => {
    fakeCloudflare();
    const start = await api("/api/cloudflare/connect");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const other = state.replace("~localhost", "~evil.example");
    expect((await api(`/api/cloudflare/callback?code=x&state=${encodeURIComponent(other)}`)).headers.get("location")).toBe("/?cloudflare=failed");
    expect((await api(`/api/cloudflare/callback?code=x&state=${encodeURIComponent(state)}`)).headers.get("location")).toBe("/?cloudflare=connected");
    expect((await api(`/api/cloudflare/callback?code=x&state=${encodeURIComponent(state)}`)).headers.get("location")).toBe("/?cloudflare=failed");
  });

  it("refreshes an expired token before using it", async () => {
    const { state } = fakeCloudflare({ routingEnabled: true });
    const link = await appEnv.DIRECTORY.get(appEnv.DIRECTORY.idFromName("directory")).cfLink("cf-test-client");
    await appEnv.DIRECTORY.get(appEnv.DIRECTORY.idFromName("directory")).cfSave({ ...link!, expiresAt: Date.now() - 1000 });
    await api("/api/cloudflare/session");
    expect(state.tokenForms.at(-1)?.get("grant_type")).toBe("refresh_token");
    expect(state.tokenForms.at(-1)?.get("refresh_token")).toBe("cf-refresh");
  });
});

describe("what nimbox does with the connection", () => {
  it("turns on sign-in, sets up receiving after approval, manages address rules, and changes the sign-in length", async () => {
    const { state } = fakeCloudflare();
    await api("/api/cloudflare", { method: "DELETE", body: "{}" });
    await connect();

    expect((await api("/api/cloudflare/protect", { method: "POST", body: "{}" })).status).toBe(200);
    expect(state.apps[0]).toMatchObject({
      destinations: [{ type: "worker", worker_id: "tag123" }],
      policies: [{ decision: "allow", include: [{ cloudflare_account_member: { account_id: "acc1" } }] }],
    });

    await api("/api/mailboxes", { method: "POST", body: JSON.stringify({ address: "me@mail.example" }) });
    const [status] = (await (await api("/api/cloudflare/receiving")).json()) as { conflicts: { id: string }[]; enabled: boolean; missing: string[] }[];
    expect(status).toMatchObject({ enabled: false, missing: ["me@mail.example"] });
    expect(status.conflicts.map((c) => c.id)).toEqual(["mx1", "spf"]);

    const refused = await api("/api/cloudflare/receiving", { method: "POST", body: JSON.stringify({ domain: "mail.example", approve: ["mx1"] }) });
    expect(refused.status).toBe(409);
    expect(state.dns.map((r) => r.id)).toContain("mx1");

    const done = await api("/api/cloudflare/receiving", { method: "POST", body: JSON.stringify({ domain: "mail.example", approve: ["mx1", "spf"] }) });
    expect(await done.json()).toMatchObject({ enabled: true, missing: [], elsewhere: [] });
    expect(state.dns.map((r) => r.id)).toEqual(["site"]);
    expect(state.rules).toHaveLength(1);
    expect(state.rules[0]).toMatchObject({ matchers: [{ type: "literal", field: "to", value: "me@mail.example" }], actions: [{ type: "worker", value: ["nimbox"] }] });

    const added = await (await api("/api/mailboxes", { method: "POST", body: JSON.stringify({ address: "hello@mail.example" }) })).json();
    expect(added).toMatchObject({ routed: true });
    expect(state.rules).toHaveLength(2);

    expect((await api("/api/mailboxes/hello@mail.example", { method: "DELETE", body: "{}" })).status).toBe(200);
    expect(state.rules).toHaveLength(1);

    const session = await api("/api/cloudflare/session", { method: "PUT", body: JSON.stringify({ duration: "168h" }) });
    expect(await session.json()).toMatchObject({ protected: true, duration: "168h" });
    expect(state.apps[0]).toMatchObject({ session_duration: "168h" });
    expect(state.apps[0]).not.toHaveProperty("aud");
  });

  it("writes Brevo's records into the domain's DNS", async () => {
    const { state } = fakeCloudflare({ routingEnabled: true });
    await api("/api/cloudflare", { method: "DELETE", body: "{}" });
    await connect();
    await api("/api/mailboxes", { method: "POST", body: JSON.stringify({ address: "me@mail.example" }) });
    await api("/api/setup/brevo-key", { method: "POST", body: JSON.stringify({ key: "xkeysib-0123456789abcdef0123456789abcdef" }) });
    const cloudflareFake = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === "api.brevo.com" && url.pathname === "/v3/senders/domains/mail.example") {
        return Response.json({
          domain: "mail.example",
          verified: false,
          authenticated: false,
          dns_records: {
            dkim_record: { type: "TXT", host_name: "mail._domainkey", value: "k=rsa;p=abc", status: false },
            brevo_code: { type: "TXT", host_name: "@", value: "brevo-code:123", status: false },
          },
        });
      }
      if (url.hostname === "api.brevo.com") return Response.json({});
      return cloudflareFake(input, init);
    });
    const written = await api("/api/setup/brevo-records", { method: "POST", body: JSON.stringify({ domain: "mail.example" }) });
    expect(written.status, await written.clone().text()).toBe(200);
    const added = state.dns.filter((r) => r.id.startsWith("r"));
    expect(added.map((r) => [r.name, r.content])).toEqual([
      ["mail._domainkey.mail.example", "k=rsa;p=abc"],
      ["mail.example", "brevo-code:123"],
    ]);
  });

  it("wipes its data and removes everything it created when asked to uninstall, the Worker last", async () => {
    const { state, calls } = fakeCloudflare({ routingEnabled: true });
    await api("/api/cloudflare", { method: "DELETE", body: "{}" });
    await connect();
    await api("/api/cloudflare/protect", { method: "POST", body: "{}" });
    await api("/api/mailboxes", { method: "POST", body: JSON.stringify({ address: "bye@mail.example" }) });
    await appEnv.MAIL.put("bye@mail.example/2026/11/x.eml", "hi");

    expect((await api("/api/cloudflare/uninstall", { method: "POST", body: JSON.stringify({ confirm: "yes" }) })).status).toBe(400);
    const removed = await api("/api/cloudflare/uninstall", { method: "POST", body: JSON.stringify({ confirm: "delete everything" }) });
    expect(removed.status, await removed.clone().text()).toBe(200);
    expect(await removed.json()).toMatchObject({ ok: true, bucket: "my-mail", workerName: "nimbox" });

    expect(state.rules.filter((r) => JSON.stringify(r).includes("bye@mail.example"))).toHaveLength(0);
    expect(state.apps).toHaveLength(0);
    expect((await appEnv.MAIL.list()).objects).toHaveLength(0);
    expect(calls.some((c) => c.method === "DELETE" && c.url.pathname.endsWith("/r2/buckets/my-mail"))).toBe(true);
    const deletes = calls.filter((c) => c.method === "DELETE").map((c) => c.url.pathname.replace("/client/v4", ""));
    expect(deletes.at(-1)).toBe("/accounts/acc1/workers/scripts/nimbox");
    expect(calls.find((c) => c.method === "DELETE" && c.url.pathname.endsWith("/workers/scripts/nimbox"))?.url.searchParams.get("force")).toBe("true");
    expect(state.revoked.length).toBeGreaterThan(0);
    expect(await (await api("/api/mailboxes")).json()).toEqual([]);
    expect(await (await api("/api/cloudflare")).json()).toMatchObject({ connected: false });
  });

});

describe("forwarding", () => {
  it("asks Cloudflare to confirm a new forwarding address", async () => {
    const { calls } = fakeCloudflare({ routingEnabled: true });
    await api("/api/cloudflare", { method: "DELETE", body: "{}" });
    await connect();
    const realFake = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname.endsWith("/email/routing/addresses")) {
        calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return Response.json({ success: true, result: (init?.method ?? "GET") === "GET" ? [] : { email: "copy@example.net" } });
      }
      return realFake(input, init);
    });
    await api("/api/mailboxes", { method: "POST", body: JSON.stringify({ address: "fw@mail.example" }) });
    const saved = await api("/api/mailboxes/fw@mail.example", { method: "PATCH", body: JSON.stringify({ forwardTo: "copy@example.net" }) });
    expect(await saved.json()).toMatchObject({ forwardTo: "copy@example.net", forwardStatus: "sent" });
    expect(calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/email/routing/addresses"))?.body).toEqual({ email: "copy@example.net" });
  });
});

describe("adding an address while connected", () => {
  it("says so when Cloudflare refuses to create its rule", async () => {
    fakeCloudflare({ routingEnabled: true, rulesFail: true });
    await api("/api/cloudflare", { method: "DELETE", body: "{}" });
    await connect();
    const added = await (await api("/api/mailboxes", { method: "POST", body: JSON.stringify({ address: "late@mail.example" }) })).json();
    expect(added).toMatchObject({ address: "late@mail.example", routed: false, routeError: expect.stringContaining("Cloudflare did not allow this") });
    const [status] = (await (await api("/api/cloudflare/receiving")).json()) as { missing: string[] }[];
    expect(status.missing).toContain("late@mail.example");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker/index";
import { api, appEnv, deliver, rawEmail } from "./helpers";

afterEach(() => vi.restoreAllMocks());

function mockBrevo(handler: (url: URL, init?: RequestInit) => Response | undefined) {
  const realFetch = globalThis.fetch;
  const calls: { method: string; path: string; key: string | null; body?: unknown }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.hostname === "cloudflare-dns.com") {
      return Response.json({ Answer: [{ type: 15, data: "1 aspmx.l.google.com." }] });
    }
    if (url.hostname === "api.brevo.com") {
      calls.push({
        method: init?.method ?? "GET",
        path: url.pathname,
        key: new Headers(init?.headers).get("api-key"),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return handler(url, init) ?? Response.json({ message: "Not found" }, { status: 404 });
    }
    return realFetch(input, init);
  });
  return calls;
}

describe("the app itself", () => {
  it("serves the inbox page from the Worker for any non-API path", async () => {
    for (const path of ["/", "/inbox/123"]) {
      const response = await worker.fetch!(new Request(`http://localhost${path}`) as never, appEnv, {} as ExecutionContext);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain('<div id="root">');
    }
  });
});

describe("setup", () => {
  it("saves a pasted Brevo key, shows the domain's DNS records, and sends a test email", async () => {
    const env = { ...appEnv, BREVO_API_KEY: "" };
    const call = (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (init.body) headers.set("content-type", "application/json");
      return worker.fetch!(new Request(`http://localhost${path}`, { ...init, headers }) as never, env, {} as ExecutionContext);
    };
    await call("/api/mailboxes", { method: "POST", body: JSON.stringify({ address: "hi@setup.example" }) });

    expect(await (await call("/api/status")).json()).toMatchObject({ brevo: false, setupDone: false });
    expect((await call("/api/setup/brevo-key", { method: "POST", body: JSON.stringify({ key: "short" }) })).status).toBe(400);
    const key = "xkeysib-0123456789abcdef0123456789abcdef";
    expect((await call("/api/setup/brevo-key", { method: "POST", body: JSON.stringify({ key }) })).status).toBe(200);
    const status = await (await call("/api/status")).json();
    expect(status).toMatchObject({ brevo: true });
    expect(JSON.stringify(status)).not.toContain(key);

    let created = false;
    const calls = mockBrevo((url, init) => {
      if (url.pathname === "/v3/senders/domains/setup.example" && (init?.method ?? "GET") === "GET") {
        if (!created) return Response.json({ message: "Domain does not exist" }, { status: 404 });
        return Response.json({
          domain: "setup.example",
          verified: false,
          authenticated: false,
          dns_records: {
            dkim_record: { type: "TXT", host_name: "mail._domainkey.", value: "k=rsa;p=abc", status: false },
            brevo_code: { type: "TXT", host_name: "", value: "brevo-code:123", status: true },
            dmarc_record: { type: "TXT", host_name: "_dmarc", value: "v=DMARC1; p=none", status: false },
          },
        });
      }
      if (url.pathname === "/v3/senders/domains" && init?.method === "POST") {
        created = true;
        return Response.json({ id: "1" });
      }
      if (url.pathname === "/v3/smtp/email") return Response.json({ messageId: "<t@brevo>" }, { status: 201 });
      return undefined;
    });

    const setup = await (await call("/api/setup")).json();
    expect(setup).toMatchObject({
      brevo: { connected: true, fromDeploy: false, sendVerified: false },
      received: false,
      domains: [
        {
          domain: "setup.example",
          state: "pending",
          records: [
            { type: "TXT", name: "mail._domainkey", value: "k=rsa;p=abc", ok: false },
            { type: "TXT", name: "@", value: "brevo-code:123", ok: true },
            { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none", ok: false },
          ],
        },
      ],
    });
    expect(calls.every((c) => c.key === key)).toBe(true);

    const test = await call("/api/setup/test-email", { method: "POST", body: JSON.stringify({ mailbox: "hi@setup.example" }) });
    expect(test.status).toBe(200);
    expect(await test.clone().json()).toEqual({ ok: true, to: "dev@example.com", provider: "gmail" });
    expect(await (await call("/api/setup")).json()).toMatchObject({ brevo: { sendVerified: true } });
    expect(calls.find((c) => c.path === "/v3/smtp/email")?.body).toMatchObject({ sender: { email: "hi@setup.example" }, to: [{ email: "dev@example.com" }] });

    await call("/api/setup/brevo-key", { method: "POST", body: JSON.stringify({ key: `${key}x` }) });
    expect(await (await call("/api/setup")).json()).toMatchObject({ brevo: { sendVerified: false } });

    await call("/api/setup/done", { method: "POST", body: "{}" });
    expect(await (await call("/api/status")).json()).toMatchObject({ setupDone: true });
  });

  it("explains a refused Brevo key in plain words", async () => {
    mockBrevo(() => Response.json({ message: "Key not found" }, { status: 401 }));
    await api("/api/mailboxes", { method: "POST", body: JSON.stringify({ address: "bad@key.example" }) });
    const response = await api("/api/setup/test-email", { method: "POST", body: JSON.stringify({ mailbox: "bad@key.example" }) });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Brevo did not accept the key") });
  });

  it("notices when mail has arrived", async () => {
    await deliver(rawEmail({ from: "a@example.org", to: "got@mail.example", subject: "Hi", messageId: "<g@example.org>" }), "a@example.org", "got@mail.example");
    mockBrevo(() => Response.json({}, { status: 401 }));
    expect(await (await api("/api/setup")).json()).toMatchObject({ received: true });
  });
});

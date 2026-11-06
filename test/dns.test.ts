import { afterEach, describe, expect, it, vi } from "vitest";
import { oldMailRecords } from "../src/worker/dns";

afterEach(() => vi.restoreAllMocks());

function mockDns(records: Record<string, { type: number; data: string }[]>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return Response.json({ Answer: records[`${url.searchParams.get("name")}/${url.searchParams.get("type")}`] ?? [] });
  });
}

describe("old mail records", () => {
  it("lists a forwarder's MX records and its SPF record, and keeps other TXT records", async () => {
    mockDns({
      "old.example/MX": [
        { type: 15, data: "10 mx1.improvmx.com." },
        { type: 15, data: "20 mx2.improvmx.com." },
      ],
      "old.example/TXT": [
        { type: 16, data: '"v=spf1 include:spf.improvmx.com ~all"' },
        { type: 16, data: '"brevo-code:abc123"' },
        { type: 16, data: '"google-site-verification=xyz"' },
      ],
    });
    expect(await oldMailRecords("old.example")).toEqual({
      domain: "old.example",
      checked: true,
      remove: [
        { type: "MX", name: "@", content: "mx1.improvmx.com", priority: 10 },
        { type: "MX", name: "@", content: "mx2.improvmx.com", priority: 20 },
        { type: "TXT", name: "@", content: "v=spf1 include:spf.improvmx.com ~all" },
      ],
    });
  });

  it("asks for nothing once Cloudflare's own records are in place", async () => {
    mockDns({
      "done.example/MX": [{ type: 15, data: "13 route1.mx.cloudflare.net." }],
      "done.example/TXT": [{ type: 16, data: '"v=spf1 include:_spf.mx.cloudflare.net ~all"' }],
    });
    expect((await oldMailRecords("done.example")).remove).toEqual([]);
  });

  it("joins long TXT records split into several strings", async () => {
    mockDns({
      "split.example/MX": [{ type: 15, data: "10 mail.host.example." }],
      "split.example/TXT": [{ type: 16, data: '"v=spf1 include:a.example " "include:b.example ~all"' }],
    });
    expect((await oldMailRecords("split.example")).remove[1]).toEqual({ type: "TXT", name: "@", content: "v=spf1 include:a.example include:b.example ~all" });
  });
});

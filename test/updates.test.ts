import { afterEach, describe, expect, it, vi } from "vitest";
import { VERSION } from "../src/worker/release";
import { mergeWranglerConfig } from "../src/worker/wrangler-merge";
import { gitBlobSha, readZip } from "../src/worker/zip";
import { api } from "./helpers";
import { makeZip } from "./zip";

afterEach(() => vi.restoreAllMocks());

const UPSTREAM_WRANGLER = `{
  // upstream
  "name": "nimbox",
  "main": "src/worker/index.ts",
  "r2_buckets": [{ "binding": "MAIL", "bucket_name": "nimbox-mail" }],
  "migrations": [{ "tag": "v1" }, { "tag": "v2" }],
}`;
const THEIR_WRANGLER = `{
  "name": "my-mail",
  "main": "src/worker/index.ts",
  "r2_buckets": [{ "binding": "MAIL", "bucket_name": "my-bucket" }],
  "migrations": [{ "tag": "v1" }]
}`;

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response> | undefined;

function mockGithub(handler: Handler) {
  const realFetch = globalThis.fetch;
  const calls: { method: string; url: string; body?: unknown }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.hostname.endsWith("github.com")) {
      const method = init?.method ?? "GET";
      calls.push({ method, url: href, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const response = await handler(url, init);
      return response ?? Response.json({ message: "Not Found" }, { status: 404 });
    }
    return realFetch(input, init);
  });
  return calls;
}

function b64(text: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

describe("helpers", () => {
  it("reads stored and deflated zip entries", async () => {
    const zip = await makeZip([
      { path: "a.txt", content: "hello" },
      { path: "src/b.ts", content: "x".repeat(500), deflate: true },
    ]);
    const files = await readZip(zip);
    expect(files.map((f) => f.path)).toEqual(["a.txt", "src/b.ts"]);
    expect(new TextDecoder().decode(files[1].data)).toBe("x".repeat(500));
  });

  it("computes git blob hashes", async () => {
    expect(await gitBlobSha(new TextEncoder().encode("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });

  it("keeps the person's names when merging wrangler config", () => {
    const merged = JSON.parse(mergeWranglerConfig(UPSTREAM_WRANGLER, THEIR_WRANGLER));
    expect(merged.name).toBe("my-mail");
    expect(merged.r2_buckets[0].bucket_name).toBe("my-bucket");
    expect(merged.migrations).toHaveLength(2);
  });
});

describe("github connection and updates", () => {
  it("connects through the device flow, finds the copy and pushes the release", async () => {
    let polls = 0;
    const theirReadme = "same readme\n";
    const readmeSha = await gitBlobSha(new TextEncoder().encode(theirReadme));
    const zip = await makeZip([
      { path: "README.md", content: theirReadme },
      { path: "src/keep.ts", content: "export const a = 2;\n", deflate: true },
      { path: "src/new.ts", content: "export const b = 1;\n" },
      { path: "wrangler.jsonc", content: UPSTREAM_WRANGLER },
      { path: ".github/workflows/ci.yml", content: "name: changed\n" },
    ]);

    const calls = mockGithub((url, init) => {
      const method = init?.method ?? "GET";
      const path = url.pathname + url.search;
      if (url.hostname === "github.com" && url.pathname === "/login/device/code") {
        return Response.json({ device_code: "dev-1", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
      }
      if (url.hostname === "github.com" && url.pathname === "/login/oauth/access_token") {
        polls++;
        if (polls === 1) return Response.json({ error: "authorization_pending" });
        return Response.json({ access_token: "ghu_1", expires_in: 28800, refresh_token: "ghr_1", refresh_token_expires_in: 15897600 });
      }
      if (path === "/user") return Response.json({ login: "octo" });
      if (path.startsWith("/user/installations?")) return Response.json({ installations: [{ id: 7 }] });
      if (path.startsWith("/user/installations/7/repositories")) return Response.json({ repositories: [{ full_name: "octo/my-nimbox" }] });
      if (path === "/repos/YoseptF/nimbox/releases/latest") {
        return Response.json({ tag_name: "v99.0.0", name: "nimbox 99.0.0", body: "- Faster inbox", html_url: "https://example.test/r", published_at: "2026-11-01T00:00:00Z" });
      }
      if (path === "/repos/YoseptF/nimbox/zipball/v99.0.0") return new Response(zip);
      if (path === "/repos/octo/my-nimbox") return Response.json({ default_branch: "main" });
      if (path === "/repos/octo/my-nimbox/git/ref/heads/main") return Response.json({ object: { sha: "head1" } });
      if (path === "/repos/octo/my-nimbox/git/commits/head1") return Response.json({ tree: { sha: "tree1" } });
      if (path === "/repos/octo/my-nimbox/git/trees/tree1?recursive=1") {
        return Response.json({
          truncated: false,
          tree: [
            { path: "README.md", mode: "100644", type: "blob", sha: readmeSha },
            { path: "src/keep.ts", mode: "100644", type: "blob", sha: "old-keep" },
            { path: "src/old.ts", mode: "100644", type: "blob", sha: "old-file" },
            { path: "notes/mine.md", mode: "100644", type: "blob", sha: "mine" },
            { path: "wrangler.jsonc", mode: "100644", type: "blob", sha: "w1" },
            { path: ".github/workflows/ci.yml", mode: "100644", type: "blob", sha: "ci" },
          ],
        });
      }
      if (path === "/repos/octo/my-nimbox/git/blobs/w1") return Response.json({ content: b64(THEIR_WRANGLER) });
      if (path === "/repos/octo/my-nimbox/git/trees" && method === "POST") return Response.json({ sha: "tree2" });
      if (path === "/repos/octo/my-nimbox/git/commits" && method === "POST") return Response.json({ sha: "commit2" });
      if (path === "/repos/octo/my-nimbox/git/refs/heads/main" && method === "PATCH") return Response.json({ ref: "refs/heads/main" });
      return undefined;
    });

    const before = await (await api("/api/github")).json();
    expect(before).toMatchObject({ enabled: true, connected: false, skipped: false });

    const start = await (await api("/api/github/connect", { method: "POST", body: "{}" })).json();
    expect(start).toMatchObject({ userCode: "ABCD-1234" });
    expect(JSON.stringify(start)).not.toContain("dev-1");

    expect(await (await api("/api/github/poll", { method: "POST", body: "{}" })).json()).toMatchObject({ status: "pending" });
    const done = await (await api("/api/github/poll", { method: "POST", body: "{}" })).json();
    expect(done).toMatchObject({ status: "connected", github: { connected: true, repo: "octo/my-nimbox", login: "octo" } });

    const state = await (await api("/api/updates")).json();
    expect(state).toMatchObject({ current: VERSION, available: true, latest: { version: "99.0.0", notes: "- Faster inbox" } });

    const applied = await api("/api/updates/apply", { method: "POST", body: "{}" });
    expect(await applied.json()).toEqual({ status: "updated", version: "99.0.0", commit: "commit2" });

    const treeCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/git/trees"))!;
    const body = treeCall.body as { base_tree: string; tree: { path: string; content?: string; sha?: string | null }[] };
    expect(body.base_tree).toBe("tree1");
    const paths = Object.fromEntries(body.tree.map((e) => [e.path, e]));
    expect(Object.keys(paths).sort()).toEqual(["src/keep.ts", "src/new.ts", "src/old.ts", "wrangler.jsonc"]);
    expect(paths["src/old.ts"].sha).toBeNull();
    const wrangler = JSON.parse(paths["wrangler.jsonc"].content!);
    expect(wrangler).toMatchObject({ name: "my-mail", r2_buckets: [{ bucket_name: "my-bucket" }] });
    expect(wrangler.migrations).toHaveLength(2);

    const commitCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/git/commits"))!;
    expect(commitCall.body).toMatchObject({ tree: "tree2", parents: ["head1"], message: "Update nimbox to 99.0.0" });
    expect(calls.some((c) => c.method === "PATCH" && (c.body as { sha: string }).sha === "commit2")).toBe(true);

    expect(await (await api("/api/updates")).json()).toMatchObject({ pending: { version: "99.0.0", commit: "commit2" } });
  });

  it("asks to connect again when the token can no longer be refreshed", async () => {
    mockGithub((url) => {
      if (url.pathname === "/login/device/code") return Response.json({ device_code: "d", user_code: "Q", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
      if (url.pathname === "/login/oauth/access_token") {
        if (url.searchParams.get("grant_type") === "refresh_token") return Response.json({ error: "bad_refresh_token" });
        return Response.json({ access_token: "ghu_x", expires_in: 1, refresh_token: "ghr_x", refresh_token_expires_in: 15897600 });
      }
      if (url.pathname === "/user") return Response.json({ login: "octo" });
      if (url.pathname === "/user/installations") return Response.json({ installations: [] });
      return undefined;
    });
    await api("/api/github/connect", { method: "POST", body: "{}" });
    await api("/api/github/poll", { method: "POST", body: "{}" });
    const state = await (await api("/api/github")).json();
    expect(state).toMatchObject({ connected: false, lapsed: true });
    const apply = await api("/api/updates/apply", { method: "POST", body: "{}" });
    expect(apply.status).toBe(409);
    expect(await apply.json()).toMatchObject({ code: "not_connected" });
  });

  it("remembers that the person skipped the GitHub step", async () => {
    const result = await (await api("/api/github/skip", { method: "POST", body: "{}" })).json();
    expect(result).toMatchObject({ skipped: true, connected: false });
  });
});

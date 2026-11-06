import { DurableObject } from "cloudflare:workers";
import type { AppEnv } from "./env";
import { github, githubBytes, GithubError, pollDeviceFlow, refreshToken, startDeviceFlow, type TokenSet } from "./github";
import { compareVersions, GITHUB_APP_SLUG, GITHUB_CLIENT_ID, UPSTREAM_REPO, VERSION } from "./release";
import { mergeWranglerConfig } from "./wrangler-merge";
import { gitBlobSha, readZip } from "./zip";

const RELEASE_TTL = 60 * 60 * 1000;
const REFRESH_EARLY = 60 * 60 * 1000;
const DELETABLE = /^(src|test)\//;
const SKIPPED_PATHS = /^\.github\//;
const WRANGLER = "wrangler.jsonc";

export interface Release {
  version: string;
  tag: string;
  name: string;
  notes: string;
  url: string;
  publishedAt: string;
}

interface Device {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
}

interface Pending {
  version: string;
  commit: string;
  startedAt: number;
}

export interface GithubState {
  enabled: boolean;
  connected: boolean;
  lapsed: boolean;
  skipped: boolean;
  login: string | null;
  repo: string | null;
  candidates: string[];
  installUrl: string;
}

export interface UpdateState {
  current: string;
  latest: Release | null;
  available: boolean;
  pending: Pending | null;
}

export type PollResult = { status: "pending" | "expired" | "denied" | "connected"; interval?: number; github: GithubState };

export type ApplyResult = { status: "updated"; version: string; commit: string } | { status: "up-to-date"; version: string };

export class UpdateError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

export type UpdaterAction = "githubState" | "startConnect" | "pollConnect" | "chooseRepo" | "skip" | "disconnect" | "updateState" | "apply";

export type UpdaterResult<T = unknown> = { ok: true; data: T } | { ok: false; status: number; message: string; code?: string };

export class Updater extends DurableObject<AppEnv> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }

  async run(action: UpdaterAction, arg?: string): Promise<UpdaterResult> {
    try {
      const data = action === "chooseRepo" ? await this.chooseRepo(arg ?? "") : await this[action]();
      return { ok: true, data };
    } catch (error) {
      if (error instanceof UpdateError) return { ok: false, status: error.status, message: error.message, code: error.code };
      if (error instanceof GithubError) return { ok: false, status: 502, message: `GitHub: ${error.message}` };
      console.error(error);
      return { ok: false, status: 500, message: "Something went wrong while talking to GitHub" };
    }
  }

  private get<T>(key: string): T | null {
    const rows = this.sql.exec("SELECT value FROM state WHERE key = ?", key).toArray();
    return rows.length ? (JSON.parse(rows[0].value as string) as T) : null;
  }

  private set(key: string, value: unknown) {
    if (value === null || value === undefined) this.sql.exec("DELETE FROM state WHERE key = ?", key);
    else this.sql.exec("INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)", key, JSON.stringify(value));
  }

  private clientId() {
    return (this.env.GITHUB_CLIENT_ID || GITHUB_CLIENT_ID).trim();
  }

  private installUrl() {
    return `https://github.com/apps/${(this.env.GITHUB_APP_SLUG || GITHUB_APP_SLUG).trim()}/installations/new`;
  }

  private lapse() {
    this.set("token", null);
    this.set("lapsed", true);
  }

  private async token(): Promise<string | null> {
    const token = this.get<TokenSet>("token");
    if (!token) return null;
    const now = Date.now();
    if (token.expiresAt === null || token.expiresAt - now > REFRESH_EARLY) return token.accessToken;
    if (!token.refreshToken || (token.refreshExpiresAt !== null && token.refreshExpiresAt <= now)) {
      this.lapse();
      return null;
    }
    const result = await refreshToken(this.clientId(), token.refreshToken, now);
    if (!result.ok) {
      this.lapse();
      return null;
    }
    this.set("token", result.token);
    return result.token.accessToken;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.token();
    if (!token) throw new UpdateError(409, "Connect GitHub first", "not_connected");
    try {
      return await github<T>(path, token, init);
    } catch (error) {
      if (error instanceof GithubError && error.status === 401) {
        this.lapse();
        throw new UpdateError(409, "The GitHub connection stopped working. Connect again.", "not_connected");
      }
      throw error;
    }
  }

  private async candidates(): Promise<string[]> {
    const { installations } = await this.call<{ installations: { id: number }[] }>("/user/installations?per_page=100");
    const repos: string[] = [];
    for (const installation of installations.slice(0, 10)) {
      const { repositories } = await this.call<{ repositories: { full_name: string }[] }>(
        `/user/installations/${installation.id}/repositories?per_page=100`,
      );
      repos.push(...repositories.map((r) => r.full_name));
    }
    return [...new Set(repos)];
  }

  async githubState(): Promise<GithubState> {
    const enabled = Boolean(this.clientId());
    const base = {
      enabled,
      skipped: this.get<boolean>("skipped") ?? false,
      installUrl: this.installUrl(),
      candidates: [] as string[],
    };
    const token = enabled ? await this.token() : null;
    if (!token) {
      return { ...base, connected: false, lapsed: this.get<boolean>("lapsed") ?? false, login: null, repo: null };
    }
    let repo = this.get<string>("repo");
    let candidates: string[] = [];
    if (!repo) {
      try {
        candidates = await this.candidates();
      } catch (error) {
        if (error instanceof UpdateError && error.code === "not_connected") return this.githubState();
        throw error;
      }
      if (candidates.length === 1) {
        repo = candidates[0];
        this.set("repo", repo);
      }
    }
    return { ...base, connected: true, lapsed: false, login: this.get<string>("login"), repo, candidates };
  }

  async startConnect() {
    const clientId = this.clientId();
    if (!clientId) throw new UpdateError(503, "Updates are not available in this copy");
    const device = await startDeviceFlow(clientId);
    const stored: Device = {
      deviceCode: device.deviceCode,
      userCode: device.userCode,
      verificationUri: device.verificationUri,
      expiresAt: Date.now() + device.expiresIn * 1000,
      interval: device.interval,
    };
    this.set("device", stored);
    return { userCode: stored.userCode, verificationUri: stored.verificationUri, expiresAt: stored.expiresAt, interval: stored.interval };
  }

  async pollConnect(): Promise<PollResult> {
    const device = this.get<Device>("device");
    if (!device || device.expiresAt <= Date.now()) {
      this.set("device", null);
      return { status: "expired", github: await this.githubState() };
    }
    const result = await pollDeviceFlow(this.clientId(), device.deviceCode);
    if (result.ok) {
      this.set("device", null);
      this.set("token", result.token);
      this.set("lapsed", null);
      this.set("skipped", null);
      try {
        const user = await github<{ login: string }>("/user", result.token.accessToken);
        this.set("login", user.login);
      } catch {}
      const repo = this.get<string>("repo");
      if (repo) {
        try {
          await github(`/repos/${repo}`, result.token.accessToken);
        } catch {
          this.set("repo", null);
        }
      }
      return { status: "connected", github: await this.githubState() };
    }
    if (result.error === "authorization_pending") return { status: "pending", interval: device.interval, github: await this.githubState() };
    if (result.error === "slow_down") {
      const interval = result.interval ?? device.interval + 5;
      this.set("device", { ...device, interval });
      return { status: "pending", interval, github: await this.githubState() };
    }
    this.set("device", null);
    if (result.error === "access_denied") return { status: "denied", github: await this.githubState() };
    return { status: "expired", github: await this.githubState() };
  }

  async chooseRepo(repo: string) {
    const candidates = await this.candidates();
    if (!candidates.includes(repo)) throw new UpdateError(400, "nimbox does not have access to that repository");
    this.set("repo", repo);
    return this.githubState();
  }

  async skip() {
    this.set("skipped", true);
    return this.githubState();
  }

  async disconnect() {
    this.set("token", null);
    this.set("repo", null);
    this.set("login", null);
    this.set("lapsed", null);
    this.set("device", null);
    this.set("skipped", true);
    return this.githubState();
  }

  private async latestRelease(force = false): Promise<Release | null> {
    const cached = this.get<{ fetchedAt: number; release: Release | null }>("release");
    if (cached && !force && Date.now() - cached.fetchedAt < RELEASE_TTL) return cached.release;
    const token = this.clientId() ? await this.token().catch(() => null) : null;
    try {
      const data = await github<{ tag_name: string; name: string | null; body: string | null; html_url: string; published_at: string }>(
        `/repos/${UPSTREAM_REPO}/releases/latest`,
        token,
      );
      const release: Release = {
        version: data.tag_name.replace(/^v/, ""),
        tag: data.tag_name,
        name: data.name || data.tag_name,
        notes: data.body ?? "",
        url: data.html_url,
        publishedAt: data.published_at,
      };
      this.set("release", { fetchedAt: Date.now(), release });
      return release;
    } catch (error) {
      if (error instanceof GithubError && error.status === 404) {
        this.set("release", { fetchedAt: Date.now(), release: null });
        return null;
      }
      return cached?.release ?? null;
    }
  }

  async updateState(): Promise<UpdateState> {
    const latest = await this.latestRelease();
    let pending = this.get<Pending>("pending");
    if (pending && compareVersions(VERSION, pending.version) >= 0) {
      this.set("pending", null);
      pending = null;
    }
    return { current: VERSION, latest, available: Boolean(latest && compareVersions(latest.version, VERSION) > 0), pending };
  }

  async apply(): Promise<ApplyResult> {
    const repo = this.get<string>("repo");
    if (!(await this.token())) throw new UpdateError(409, "Connect GitHub first", "not_connected");
    if (!repo) throw new UpdateError(409, "Choose your nimbox copy on GitHub first", "no_repo");
    const release = await this.latestRelease(true);
    if (!release || compareVersions(release.version, VERSION) <= 0) return { status: "up-to-date", version: VERSION };

    const files = await readZip(await githubBytes(`/repos/${UPSTREAM_REPO}/zipball/${encodeURIComponent(release.tag)}`, await this.token()));
    const info = await this.call<{ default_branch: string }>(`/repos/${repo}`);
    const branch = info.default_branch;
    const ref = await this.call<{ object: { sha: string } }>(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    const head = ref.object.sha;
    const commit = await this.call<{ tree: { sha: string } }>(`/repos/${repo}/git/commits/${head}`);
    const tree = await this.call<{ tree: TreeEntry[]; truncated: boolean }>(`/repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new UpdateError(500, "Your copy has too many files to update automatically");

    const theirs = new Map(tree.tree.filter((e) => e.type === "blob").map((e) => [e.path, e]));
    const upstreamPaths = new Set(files.map((f) => f.path));
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const changes: Record<string, unknown>[] = [];

    for (const file of files) {
      if (SKIPPED_PATHS.test(file.path)) continue;
      const current = theirs.get(file.path);
      let data = file.data;
      if (file.path === WRANGLER && current) {
        const blob = await this.call<{ content: string }>(`/repos/${repo}/git/blobs/${current.sha}`);
        const theirText = new TextDecoder().decode(Uint8Array.from(atob(blob.content.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
        data = new TextEncoder().encode(mergeWranglerConfig(decoder.decode(file.data), theirText));
      }
      const sha = await gitBlobSha(data);
      if (current && current.sha === sha && current.mode === file.mode) continue;
      let text: string | null = null;
      try {
        text = decoder.decode(data);
      } catch {}
      if (text !== null) {
        changes.push({ path: file.path, mode: file.mode, type: "blob", content: text });
      } else {
        let binary = "";
        for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
        const blob = await this.call<{ sha: string }>(`/repos/${repo}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: btoa(binary), encoding: "base64" }),
        });
        changes.push({ path: file.path, mode: file.mode, type: "blob", sha: blob.sha });
      }
    }
    for (const path of theirs.keys()) {
      if (DELETABLE.test(path) && !upstreamPaths.has(path)) changes.push({ path, mode: "100644", type: "blob", sha: null });
    }

    if (changes.length === 0) {
      this.set("pending", { version: release.version, commit: head, startedAt: Date.now() });
      return { status: "updated", version: release.version, commit: head };
    }

    const newTree = await this.call<{ sha: string }>(`/repos/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: commit.tree.sha, tree: changes }),
    });
    const created = await this.call<{ sha: string }>(`/repos/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message: `Update nimbox to ${release.version}`, tree: newTree.sha, parents: [head] }),
    });
    try {
      await this.call(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: created.sha }),
      });
    } catch (error) {
      if (error instanceof GithubError && (error.status === 403 || error.status === 404)) {
        throw new UpdateError(403, `nimbox is not allowed to change ${repo}. Check that the nimbox-updater GitHub app is installed on it.`);
      }
      throw error;
    }
    this.set("pending", { version: release.version, commit: created.sha, startedAt: Date.now() });
    return { status: "updated", version: release.version, commit: created.sha };
  }
}

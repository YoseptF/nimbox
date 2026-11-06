import { DurableObject } from "cloudflare:workers";
import { refreshAccessToken, type CloudflareLink } from "./cloudflare";
import type { AppEnv } from "./env";

const PENDING_TTL = 15 * 60 * 1000;
const REFRESH_EARLY = 5 * 60 * 1000;

export class Directory extends DurableObject<AppEnv> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS mailboxes (address TEXT PRIMARY KEY, created_at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS cf_pending (state TEXT PRIMARY KEY, verifier TEXT NOT NULL, created_at INTEGER NOT NULL)");
  }

  cfBegin(state: string, verifier: string) {
    this.sql.exec("DELETE FROM cf_pending WHERE created_at < ?", Date.now() - PENDING_TTL);
    this.sql.exec("INSERT INTO cf_pending (state, verifier, created_at) VALUES (?, ?, ?)", state, verifier, Date.now());
  }

  cfTake(state: string): string | null {
    const rows = this.sql.exec("SELECT verifier, created_at FROM cf_pending WHERE state = ?", state).toArray();
    this.sql.exec("DELETE FROM cf_pending WHERE state = ?", state);
    if (!rows.length || (rows[0].created_at as number) < Date.now() - PENDING_TTL) return null;
    return rows[0].verifier as string;
  }

  cfSave(link: CloudflareLink) {
    this.setSetting("cf.link", JSON.stringify(link));
    this.setSetting("cf.lapsed", null);
  }

  cfForget(lapsed = false) {
    this.setSetting("cf.link", null);
    this.setSetting("cf.lapsed", lapsed ? "1" : null);
  }

  cfLapsed() {
    return this.getSetting("cf.lapsed") === "1";
  }

  async cfLink(clientId: string): Promise<CloudflareLink | null> {
    const raw = this.getSetting("cf.link");
    if (!raw) return null;
    const link = JSON.parse(raw) as CloudflareLink;
    if (link.expiresAt === null || link.expiresAt - Date.now() > REFRESH_EARLY) return link;
    if (!link.refreshToken) {
      this.cfForget(true);
      return null;
    }
    try {
      const fresh = await refreshAccessToken(clientId, link.refreshToken);
      const next = { ...link, ...fresh, refreshToken: fresh.refreshToken ?? link.refreshToken };
      this.cfSave(next);
      return next;
    } catch {
      this.cfForget(true);
      return null;
    }
  }

  getSetting(key: string): string | null {
    const rows = this.sql.exec("SELECT value FROM settings WHERE key = ?", key).toArray();
    return rows.length ? (rows[0].value as string) : null;
  }

  setSetting(key: string, value: string | null) {
    if (value === null) this.sql.exec("DELETE FROM settings WHERE key = ?", key);
    else this.sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, value);
  }

  list(): string[] {
    return this.sql
      .exec("SELECT address FROM mailboxes ORDER BY created_at ASC")
      .toArray()
      .map((r) => r.address as string);
  }

  has(address: string): boolean {
    return this.sql.exec("SELECT 1 FROM mailboxes WHERE address = ?", address.toLowerCase()).toArray().length > 0;
  }

  add(address: string) {
    this.sql.exec("INSERT OR IGNORE INTO mailboxes (address, created_at) VALUES (?, ?)", address.toLowerCase(), Date.now());
  }

  remove(address: string) {
    this.sql.exec("DELETE FROM mailboxes WHERE address = ?", address.toLowerCase());
  }
}

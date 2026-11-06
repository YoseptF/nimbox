import { DurableObject } from "cloudflare:workers";
import type { AppEnv } from "./env";

export class Directory extends DurableObject<AppEnv> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS mailboxes (address TEXT PRIMARY KEY, created_at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
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

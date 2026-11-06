import { DurableObject } from "cloudflare:workers";
import type { AppEnv } from "./env";
import type { Folder, MailboxSettings, MessageRow, NewMessage, Person, ThreadRow } from "./types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  message_id TEXT NOT NULL,
  in_reply_to TEXT,
  refs TEXT NOT NULL DEFAULT '[]',
  from_json TEXT NOT NULL,
  to_json TEXT NOT NULL,
  cc_json TEXT NOT NULL,
  subject TEXT NOT NULL,
  date INTEGER NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT NOT NULL,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, date);
CREATE INDEX IF NOT EXISTS messages_message_id ON messages(message_id);
CREATE TABLE IF NOT EXISTS thread_ids (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS thread_ids_thread ON thread_ids(thread_id);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  last_date INTEGER NOT NULL,
  count INTEGER NOT NULL,
  unread INTEGER NOT NULL,
  has_in INTEGER NOT NULL,
  has_out INTEGER NOT NULL,
  participants TEXT NOT NULL,
  snippet TEXT NOT NULL,
  has_attachments INTEGER NOT NULL,
  last_message_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS threads_date ON threads(last_date);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type Row = Record<string, SqlStorageValue>;

function toMessage(row: Row): MessageRow {
  return {
    id: row.id as string,
    threadId: row.thread_id as string,
    direction: row.direction as MessageRow["direction"],
    messageId: row.message_id as string,
    inReplyTo: (row.in_reply_to as string | null) ?? null,
    references: JSON.parse(row.refs as string),
    from: JSON.parse(row.from_json as string),
    to: JSON.parse(row.to_json as string),
    cc: JSON.parse(row.cc_json as string),
    subject: row.subject as string,
    date: row.date as number,
    snippet: row.snippet as string,
    size: row.size as number,
    r2Key: row.r2_key as string,
    hasAttachments: row.has_attachments === 1,
    read: row.read === 1,
  };
}

function toThread(row: Row): ThreadRow {
  return {
    id: row.id as string,
    subject: row.subject as string,
    lastDate: row.last_date as number,
    count: row.count as number,
    unread: row.unread as number,
    hasIn: row.has_in === 1,
    hasOut: row.has_out === 1,
    participants: JSON.parse(row.participants as string),
    snippet: row.snippet as string,
    hasAttachments: row.has_attachments === 1,
    lastMessageId: row.last_message_id as string,
  };
}

function placeholders(n: number) {
  return Array.from({ length: n }, () => "?").join(",");
}

export class Mailbox extends DurableObject<AppEnv> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(SCHEMA);
  }

  ingest(message: NewMessage): { id: string; threadId: string; duplicate: boolean } {
    return this.ctx.storage.transactionSync(() => {
      const existing = this.sql
        .exec("SELECT id, thread_id FROM messages WHERE message_id = ? AND direction = ? LIMIT 1", message.messageId, message.direction)
        .toArray();
      if (existing.length > 0) {
        return { id: existing[0].id as string, threadId: existing[0].thread_id as string, duplicate: true };
      }

      const ids = [...new Set([message.messageId, message.inReplyTo, ...message.references].filter((v): v is string => !!v))];
      const found = this.sql
        .exec(`SELECT DISTINCT thread_id FROM thread_ids WHERE message_id IN (${placeholders(ids.length)})`, ...ids)
        .toArray()
        .map((r) => r.thread_id as string);

      const threadId = found[0] ?? message.id;
      const merged = found.slice(1);
      if (merged.length > 0) {
        const marks = placeholders(merged.length);
        this.sql.exec(`UPDATE messages SET thread_id = ? WHERE thread_id IN (${marks})`, threadId, ...merged);
        this.sql.exec(`UPDATE thread_ids SET thread_id = ? WHERE thread_id IN (${marks})`, threadId, ...merged);
        this.sql.exec(`DELETE FROM threads WHERE id IN (${marks})`, ...merged);
      }

      for (const id of ids) {
        this.sql.exec("INSERT OR REPLACE INTO thread_ids (message_id, thread_id) VALUES (?, ?)", id, threadId);
      }

      this.sql.exec(
        `INSERT INTO messages (id, thread_id, direction, message_id, in_reply_to, refs, from_json, to_json, cc_json, subject, date, snippet, size, r2_key, has_attachments, read)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        message.id,
        threadId,
        message.direction,
        message.messageId,
        message.inReplyTo,
        JSON.stringify(message.references),
        JSON.stringify(message.from),
        JSON.stringify(message.to),
        JSON.stringify(message.cc),
        message.subject,
        message.date,
        message.snippet,
        message.size,
        message.r2Key,
        message.hasAttachments ? 1 : 0,
        message.read ? 1 : 0,
      );

      this.refreshThread(threadId);
      return { id: message.id, threadId, duplicate: false };
    });
  }

  private refreshThread(threadId: string) {
    const rows = this.sql.exec("SELECT * FROM messages WHERE thread_id = ? ORDER BY date ASC", threadId).toArray().map(toMessage);
    if (rows.length === 0) {
      this.sql.exec("DELETE FROM threads WHERE id = ?", threadId);
      return;
    }
    const last = rows[rows.length - 1];
    const participants: Person[] = [];
    for (const row of rows) {
      if (!participants.some((p) => p.address === row.from.address)) participants.push(row.from);
    }
    this.sql.exec(
      `INSERT OR REPLACE INTO threads (id, subject, last_date, count, unread, has_in, has_out, participants, snippet, has_attachments, last_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      threadId,
      rows[0].subject,
      last.date,
      rows.length,
      rows.filter((r) => !r.read).length,
      rows.some((r) => r.direction === "in") ? 1 : 0,
      rows.some((r) => r.direction === "out") ? 1 : 0,
      JSON.stringify(participants),
      last.snippet,
      rows.some((r) => r.hasAttachments) ? 1 : 0,
      last.id,
    );
  }

  listThreads(options: { folder: Folder; before?: number; limit?: number; query?: string }): ThreadRow[] {
    const where: string[] = [];
    const args: SqlStorageValue[] = [];
    if (options.folder === "inbox") where.push("has_in = 1");
    if (options.folder === "sent") where.push("has_out = 1");
    if (options.before) {
      where.push("last_date < ?");
      args.push(options.before);
    }
    const query = options.query?.trim();
    if (query) {
      const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(
        "id IN (SELECT thread_id FROM messages WHERE subject LIKE ? ESCAPE '\\' OR from_json LIKE ? ESCAPE '\\' OR to_json LIKE ? ESCAPE '\\' OR snippet LIKE ? ESCAPE '\\')",
      );
      args.push(like, like, like, like);
    }
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.sql
      .exec(`SELECT * FROM threads ${clause} ORDER BY last_date DESC LIMIT ?`, ...args, limit)
      .toArray()
      .map(toThread);
  }

  getThread(threadId: string): { thread: ThreadRow; messages: MessageRow[] } | null {
    const thread = this.sql.exec("SELECT * FROM threads WHERE id = ?", threadId).toArray();
    if (thread.length === 0) return null;
    const messages = this.sql.exec("SELECT * FROM messages WHERE thread_id = ? ORDER BY date ASC", threadId).toArray().map(toMessage);
    return { thread: toThread(thread[0]), messages };
  }

  getMessage(id: string): MessageRow | null {
    const rows = this.sql.exec("SELECT * FROM messages WHERE id = ?", id).toArray();
    return rows.length ? toMessage(rows[0]) : null;
  }

  setThreadRead(threadId: string, read: boolean) {
    this.sql.exec("UPDATE messages SET read = ? WHERE thread_id = ?", read ? 1 : 0, threadId);
    this.refreshThread(threadId);
  }

  setMessageSummary(id: string, snippet: string, hasAttachments: boolean) {
    const message = this.getMessage(id);
    if (!message) return;
    this.sql.exec("UPDATE messages SET snippet = ?, has_attachments = ? WHERE id = ?", snippet, hasAttachments ? 1 : 0, id);
    this.refreshThread(message.threadId);
  }

  deleteThread(threadId: string): string[] {
    return this.ctx.storage.transactionSync(() => {
      const keys = this.sql
        .exec("SELECT r2_key FROM messages WHERE thread_id = ?", threadId)
        .toArray()
        .map((r) => r.r2_key as string);
      this.sql.exec("DELETE FROM messages WHERE thread_id = ?", threadId);
      this.sql.exec("DELETE FROM thread_ids WHERE thread_id = ?", threadId);
      this.sql.exec("DELETE FROM threads WHERE id = ?", threadId);
      return keys;
    });
  }

  unreadCount(): number {
    const row = this.sql.exec("SELECT COUNT(*) AS n FROM threads WHERE has_in = 1 AND unread > 0").one();
    return row.n as number;
  }

  getSettings(): MailboxSettings {
    const rows = this.sql.exec("SELECT key, value FROM settings").toArray();
    const map = Object.fromEntries(rows.map((r) => [r.key as string, r.value as string]));
    return { displayName: map.displayName ?? "", forwardTo: map.forwardTo ?? "" };
  }

  setSettings(settings: Partial<MailboxSettings>): MailboxSettings {
    for (const [key, value] of Object.entries(settings)) {
      if (key !== "displayName" && key !== "forwardTo") continue;
      this.sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, String(value ?? "").trim());
    }
    return this.getSettings();
  }
}

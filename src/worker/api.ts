import PostalMime from "postal-mime";
import type { Email } from "postal-mime";
import { authenticate } from "./auth";
import { brevoDomain, BrevoError, plainBrevoError, sendWithBrevo } from "./brevo";
import { rawKey } from "./email";
import { directoryStub, mailboxStub, updaterStub, type AppEnv } from "./env";
import { decodeHeader, parseAddresses } from "./headers";
import { newId } from "./ids";
import { buildEml, textToHtml, type OutgoingAttachment } from "./mime";
import type { Folder, MessageRow, Person } from "./types";
import type { UpdaterAction, UpdaterResult } from "./updater";
import { VERSION } from "./release";

const ADDRESS = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
}

function checkMutation(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return;
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new HttpError(415, "Use application/json");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, "Cross-origin request refused");
}

function people(value: unknown): Person[] {
  if (!value) return [];
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  const list = parseAddresses(text);
  for (const person of list) {
    if (!ADDRESS.test(person.address)) throw new HttpError(400, `Not an email address: ${person.address}`);
  }
  return list;
}

async function requireMailbox(env: AppEnv, address: string) {
  const mailbox = decodeURIComponent(address).toLowerCase();
  if (!(await directoryStub(env).has(mailbox))) throw new HttpError(404, "Unknown mailbox");
  return mailbox;
}

function bodyKey(message: MessageRow) {
  return message.r2Key.replace(/\.eml$/, ".body.json");
}

interface ParsedBody {
  html: string;
  text: string;
  date: string;
  replyTo: Person[];
  attachments: { index: number; filename: string; mimeType: string; size: number; inline: boolean }[];
}

function attachmentSize(content: Email["attachments"][number]["content"]) {
  return typeof content === "string" ? content.length : content.byteLength;
}

function toBase64(content: ArrayBuffer | Uint8Array | string) {
  if (typeof content === "string") return btoa(content);
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function makeSnippet(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith(">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function htmlToText(html: string) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function loadRaw(env: AppEnv, message: MessageRow) {
  const object = await env.MAIL.get(message.r2Key);
  if (!object) throw new HttpError(404, "Message file missing");
  return object.arrayBuffer();
}

async function parseBody(env: AppEnv, mailbox: string, message: MessageRow): Promise<ParsedBody> {
  const cached = await env.MAIL.get(bodyKey(message));
  if (cached) return cached.json<ParsedBody>();

  const email = await PostalMime.parse(await loadRaw(env, message));
  let html = email.html ?? "";
  let inlineBudget = 4 * 1024 * 1024;
  const attachments = email.attachments.map((file, index) => {
    const size = attachmentSize(file.content);
    const cid = file.contentId?.replace(/^<|>$/g, "");
    let inline = false;
    if (cid && html.includes(`cid:${cid}`) && size <= inlineBudget) {
      inlineBudget -= size;
      inline = true;
      html = html.split(`cid:${cid}`).join(`data:${file.mimeType};base64,${toBase64(file.content)}`);
    }
    return { index, filename: decodeHeader(file.filename) || `attachment-${index + 1}`, mimeType: file.mimeType, size, inline };
  });
  const text = email.text ?? (email.html ? htmlToText(email.html) : "");
  const replyTo = (email.replyTo ?? []).flatMap((a) => (a.address ? [{ name: a.name, address: a.address.toLowerCase() }] : []));
  const parsed: ParsedBody = { html, text, date: email.date ?? "", replyTo, attachments };

  await env.MAIL.put(bodyKey(message), JSON.stringify(parsed), { httpMetadata: { contentType: "application/json" } });
  if (!message.snippet || message.hasAttachments !== attachments.some((a) => !a.inline)) {
    await mailboxStub(env, mailbox).setMessageSummary(message.id, makeSnippet(text), attachments.some((a) => !a.inline));
  }
  return parsed;
}

async function getMessageOr404(env: AppEnv, mailbox: string, id: string) {
  const message = await mailboxStub(env, mailbox).getMessage(id);
  if (!message) throw new HttpError(404, "Message not found");
  return message;
}

interface SendRequest {
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject?: string;
  text?: string;
  replyTo?: string;
  attachments?: OutgoingAttachment[];
}

async function brevoKey(env: AppEnv) {
  const pasted = await directoryStub(env).getSetting("brevoKey");
  return pasted || env.BREVO_API_KEY?.trim() || "";
}

async function send(env: AppEnv, mailbox: string, input: SendRequest) {
  const apiKey = await brevoKey(env);
  if (!apiKey) throw new HttpError(503, "Sending is not set up yet. Add your Brevo key on the setup page.");
  const to = people(input.to);
  const cc = people(input.cc);
  const bcc = people(input.bcc);
  if (to.length + cc.length + bcc.length === 0) throw new HttpError(400, "Add at least one recipient");

  const stub = mailboxStub(env, mailbox);
  const parent = input.replyTo ? await stub.getMessage(input.replyTo) : null;
  if (input.replyTo && !parent) throw new HttpError(404, "The message you are replying to is gone");
  const references = parent ? [...new Set([...parent.references, parent.messageId])].slice(-20) : [];
  const settings = await stub.getSettings();
  const from = { name: settings.displayName, address: mailbox };
  const text = input.text ?? "";
  const attachments = (input.attachments ?? []).map((a) => ({
    filename: String(a.filename || "attachment"),
    contentType: String(a.contentType || "application/octet-stream"),
    content: String(a.content || ""),
  }));
  const mail = {
    from,
    to,
    cc,
    bcc,
    subject: (input.subject ?? "").trim(),
    text,
    html: textToHtml(text),
    inReplyTo: parent?.messageId ?? null,
    references,
    attachments,
  };

  let messageId: string;
  try {
    messageId = await sendWithBrevo(apiKey, mail);
  } catch (error) {
    if (error instanceof BrevoError) throw new HttpError(502, plainBrevoError(error));
    throw error;
  }

  const now = new Date();
  const id = newId(now.getTime());
  const key = rawKey(mailbox, id, now);
  const eml = buildEml({ ...mail, messageId, date: now });
  await env.MAIL.put(key, eml, {
    httpMetadata: { contentType: "message/rfc822" },
    customMetadata: { mailbox, direction: "out" },
  });
  return stub.ingest({
    id,
    direction: "out",
    messageId,
    inReplyTo: mail.inReplyTo,
    references,
    from,
    to,
    cc,
    subject: mail.subject,
    date: now.getTime(),
    snippet: makeSnippet(text),
    size: eml.length,
    r2Key: key,
    hasAttachments: attachments.length > 0,
    read: true,
  });
}

const updateRoutes: Record<string, UpdaterAction> = {
  "GET /api/updates": "updateState",
  "POST /api/updates/apply": "apply",
  "GET /api/github": "githubState",
  "POST /api/github/connect": "startConnect",
  "POST /api/github/poll": "pollConnect",
  "POST /api/github/repo": "chooseRepo",
  "POST /api/github/skip": "skip",
  "DELETE /api/github": "disconnect",
};

function domainsOf(addresses: string[]) {
  return [...new Set(addresses.map((a) => a.slice(a.indexOf("@") + 1)))];
}

async function setupRoute(request: Request, env: AppEnv, path: string, method: string): Promise<Response | null> {
  const directory = directoryStub(env);
  if (path === "/api/setup" && method === "GET") {
    const addresses = await directory.list();
    const apiKey = await brevoKey(env);
    const domains = apiKey ? await Promise.all(domainsOf(addresses).map((d) => brevoDomain(apiKey, d).catch(() => ({ domain: d, state: "unknown" as const, records: [] })))) : [];
    const incoming = await Promise.all(addresses.map((a) => mailboxStub(env, a).hasIncoming()));
    return json({
      brevo: { connected: Boolean(apiKey), fromDeploy: Boolean(apiKey) && apiKey === env.BREVO_API_KEY?.trim() },
      domains,
      received: incoming.some(Boolean),
    });
  }
  if (path === "/api/setup/brevo-key" && method === "POST") {
    const key = ((await readJson<{ key?: string }>(request)).key ?? "").trim();
    if (key.length < 20 || /\s/.test(key)) throw new HttpError(400, "That doesn't look like a Brevo key. Copy the whole key and paste it again.");
    await directory.setSetting("brevoKey", key);
    return json({ ok: true });
  }
  if (path === "/api/setup/check-domain" && method === "POST") {
    const domain = ((await readJson<{ domain?: string }>(request)).domain ?? "").trim().toLowerCase();
    const apiKey = await brevoKey(env);
    if (!apiKey) throw new HttpError(409, "Add your Brevo key first");
    if (!domainsOf(await directory.list()).includes(domain)) throw new HttpError(404, "Unknown domain");
    return json(await brevoDomain(apiKey, domain, true));
  }
  if (path === "/api/setup/test-email" && method === "POST") {
    const mailbox = await requireMailbox(env, (await readJson<{ mailbox?: string }>(request)).mailbox ?? "");
    const apiKey = await brevoKey(env);
    if (!apiKey) throw new HttpError(409, "Add your Brevo key first");
    const settings = await mailboxStub(env, mailbox).getSettings();
    const me = { name: settings.displayName, address: mailbox };
    const text = "This is a test from nimbox. If you can read this in your nimbox inbox, sending and receiving both work.";
    try {
      await sendWithBrevo(apiKey, { from: me, to: [me], cc: [], bcc: [], subject: "nimbox test", text, html: textToHtml(text), inReplyTo: null, references: [], attachments: [] });
    } catch (error) {
      throw new HttpError(502, plainBrevoError(error));
    }
    return json({ ok: true });
  }
  if (path === "/api/setup/done" && method === "POST") {
    await directory.setSetting("setupDone", "1");
    return json({ ok: true });
  }
  return null;
}

async function route(request: Request, env: AppEnv, ctx: ExecutionContext | undefined, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;

  if (path === "/api/status" && method === "GET") {
    const user = await authenticate(request, env, ctx, true);
    if (!user) return json({ authenticated: false, email: null, version: VERSION, brevo: false, setupDone: false });
    const directory = directoryStub(env);
    return json({
      authenticated: true,
      email: user.email || null,
      version: VERSION,
      brevo: Boolean(await brevoKey(env)),
      setupDone: (await directory.getSetting("setupDone")) === "1",
    });
  }

  const user = await authenticate(request, env, ctx);
  if (!user) throw new HttpError(401, "Sign in first");
  checkMutation(request);

  const setup = await setupRoute(request, env, path, method);
  if (setup) return setup;

  const updates = updateRoutes[`${method} ${path}`];
  if (updates) {
    const arg = updates === "chooseRepo" ? (await readJson<{ repo?: string }>(request)).repo : undefined;
    const result = (await updaterStub(env).run(updates, arg)) as UpdaterResult;
    if (!result.ok) return json({ error: result.message, code: result.code }, result.status);
    return json(result.data);
  }

  if (path === "/api/mailboxes") {
    const directory = directoryStub(env);
    if (method === "GET") {
      const addresses = await directory.list();
      const mailboxes = await Promise.all(
        addresses.map(async (address) => {
          const stub = mailboxStub(env, address);
          const [unread, settings] = await Promise.all([stub.unreadCount(), stub.getSettings()]);
          return { address, unread, ...settings };
        }),
      );
      return json(mailboxes);
    }
    if (method === "POST") {
      const body = await readJson<{ address?: string }>(request);
      const address = (body.address ?? "").trim().toLowerCase();
      if (!ADDRESS.test(address)) throw new HttpError(400, "Not an email address");
      await directory.add(address);
      return json({ address }, 201);
    }
  }

  const match = path.match(/^\/api\/mailboxes\/([^/]+)(\/.*)?$/);
  if (!match) throw new HttpError(404, "Not found");
  const mailbox = await requireMailbox(env, match[1]);
  const rest = match[2] ?? "";
  const stub = mailboxStub(env, mailbox);

  if (rest === "" && method === "PATCH") {
    const body = await readJson<{ displayName?: string; forwardTo?: string }>(request);
    if (body.forwardTo && !ADDRESS.test(body.forwardTo.trim())) throw new HttpError(400, "Forward address is not an email address");
    return json(await stub.setSettings({ displayName: body.displayName, forwardTo: body.forwardTo }));
  }

  if (rest === "/threads" && method === "GET") {
    const folder = (["inbox", "sent", "all"].includes(url.searchParams.get("folder") ?? "") ? url.searchParams.get("folder") : "inbox") as Folder;
    const before = Number(url.searchParams.get("before")) || undefined;
    const query = url.searchParams.get("q") ?? undefined;
    return json(await stub.listThreads({ folder, before, query, limit: 50 }));
  }

  if (rest === "/send" && method === "POST") {
    return json(await send(env, mailbox, await readJson<SendRequest>(request)), 201);
  }

  const thread = rest.match(/^\/threads\/([^/]+)(\/read)?$/);
  if (thread) {
    const [, threadId, read] = thread;
    if (!read && method === "GET") {
      const result = await stub.getThread(threadId);
      if (!result) throw new HttpError(404, "Thread not found");
      return json(result);
    }
    if (read && method === "POST") {
      const body = await readJson<{ read?: boolean }>(request);
      await stub.setThreadRead(threadId, body.read !== false);
      return json({ ok: true });
    }
    if (!read && method === "DELETE") {
      const keys = await stub.deleteThread(threadId);
      const all = keys.flatMap((k) => [k, k.replace(/\.eml$/, ".body.json")]);
      for (let i = 0; i < all.length; i += 1000) await env.MAIL.delete(all.slice(i, i + 1000));
      return json({ ok: true });
    }
  }

  const message = rest.match(/^\/messages\/([^/]+)\/(body|raw|attachments\/(\d+))$/);
  if (message && method === "GET") {
    const [, id, kind, index] = message;
    const row = await getMessageOr404(env, mailbox, id);
    if (kind === "body") return json(await parseBody(env, mailbox, row));
    if (kind === "raw") {
      const object = await env.MAIL.get(row.r2Key);
      if (!object) throw new HttpError(404, "Message file missing");
      return new Response(object.body, {
        headers: {
          "content-type": "message/rfc822",
          "content-disposition": `attachment; filename="${row.id}.eml"`,
          "cache-control": "no-store",
        },
      });
    }
    const email = await PostalMime.parse(await loadRaw(env, row));
    const file = email.attachments[Number(index)];
    if (!file) throw new HttpError(404, "Attachment not found");
    const name = (decodeHeader(file.filename) || `attachment-${Number(index) + 1}`).replace(/[\r\n"\\]/g, "_");
    return new Response(file.content, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }

  throw new HttpError(404, "Not found");
}

export async function handleApi(request: Request, env: AppEnv, ctx?: ExecutionContext) {
  try {
    return await route(request, env, ctx, new URL(request.url));
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error(error);
    return json({ error: "Something went wrong" }, 500);
  }
}

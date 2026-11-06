import type { OutgoingMail } from "./mime";
import type { Person } from "./types";

export class BrevoError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function contact(person: Person) {
  return person.name ? { email: person.address, name: person.name.slice(0, 70) } : { email: person.address };
}

export async function sendWithBrevo(apiKey: string, mail: Omit<OutgoingMail, "messageId" | "date">) {
  const headers: Record<string, string> = {};
  if (mail.inReplyTo) headers["In-Reply-To"] = mail.inReplyTo;
  if (mail.references.length) headers["References"] = mail.references.join(" ");

  const body: Record<string, unknown> = {
    sender: contact(mail.from),
    to: mail.to.map(contact),
    subject: mail.subject || "(no subject)",
    textContent: mail.text,
    htmlContent: mail.html,
  };
  if (mail.cc.length) body.cc = mail.cc.map(contact);
  if (mail.bcc.length) body.bcc = mail.bcc.map(contact);
  if (Object.keys(headers).length) body.headers = headers;
  if (mail.attachments.length) {
    body.attachment = mail.attachments.map((a) => ({ name: a.filename, content: a.content }));
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { messageId?: string; message?: string };
  if (!response.ok || !payload.messageId) {
    throw new BrevoError(response.status, payload.message ?? `Brevo returned ${response.status}`);
  }
  const id = payload.messageId.trim();
  return id.startsWith("<") ? id : `<${id}>`;
}

export interface DnsRecord {
  type: string;
  name: string;
  value: string;
  ok: boolean;
}

export interface BrevoDomain {
  domain: string;
  state: "verified" | "pending" | "unknown" | "badkey";
  records: DnsRecord[];
}

interface BrevoRecord {
  type?: string;
  value?: string;
  host_name?: string;
  status?: boolean;
}

async function brevo(apiKey: string, path: string, init: RequestInit = {}) {
  return fetch(`https://api.brevo.com/v3${path}`, {
    ...init,
    headers: { "api-key": apiKey, accept: "application/json", "content-type": "application/json" },
  });
}

function recordName(host: string | undefined, domain: string) {
  let name = (host ?? "").trim().replace(/\.$/, "");
  if (name.endsWith(`.${domain}`)) name = name.slice(0, -domain.length - 1);
  if (name === domain || name === "") name = "@";
  return name;
}

function toDomain(domain: string, data: { verified?: boolean; authenticated?: boolean; dns_records?: Record<string, BrevoRecord> }): BrevoDomain {
  const records = Object.values(data.dns_records ?? {})
    .filter((r) => r && r.value)
    .map((r) => ({ type: r.type ?? "TXT", name: recordName(r.host_name, domain), value: String(r.value), ok: Boolean(r.status) }));
  return { domain, state: data.verified && data.authenticated ? "verified" : "pending", records };
}

export async function brevoDomain(apiKey: string, domain: string, recheck = false): Promise<BrevoDomain> {
  const path = `/senders/domains/${encodeURIComponent(domain)}`;
  if (recheck) await brevo(apiKey, `${path}/authenticate`, { method: "PUT" }).catch(() => null);
  let response = await brevo(apiKey, path);
  if (response.status === 404) {
    const created = await brevo(apiKey, "/senders/domains", { method: "POST", body: JSON.stringify({ name: domain }) });
    if (created.ok) response = await brevo(apiKey, path);
  }
  if (response.status === 401) return { domain, state: "badkey", records: [] };
  if (!response.ok) return { domain, state: "unknown", records: [] };
  return toDomain(domain, await response.json());
}

export function plainBrevoError(error: unknown) {
  if (error instanceof BrevoError) {
    if (error.status === 401) return "Brevo did not accept the key. Create a new key in Brevo and paste it again.";
    return `Brevo said: ${error.message}`;
  }
  return "Could not reach Brevo. Try again in a minute.";
}

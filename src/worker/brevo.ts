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

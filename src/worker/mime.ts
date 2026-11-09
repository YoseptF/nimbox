import { splitQuotedText, unquote } from "../shared/quote";
import type { Person } from "./types";

export interface OutgoingAttachment {
  filename: string;
  contentType: string;
  content: string;
}

export interface OutgoingMail {
  from: Person;
  to: Person[];
  cc: Person[];
  bcc: Person[];
  subject: string;
  text: string;
  html: string;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  date: Date;
  attachments: OutgoingAttachment[];
}

const encoder = new TextEncoder();

export function utf8Base64(value: string) {
  const bytes = encoder.encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function wrap(base64: string) {
  return base64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

export function encodeWord(value: string) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${utf8Base64(value)}?=`;
}

export function formatPerson(person: Person) {
  if (!person.name) return person.address;
  const name = /^[\x20-\x7e]*$/.test(person.name) ? `"${person.name.replace(/["\\]/g, "\\$&")}"` : encodeWord(person.name);
  return `${name} <${person.address}>`;
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function textToHtml(text: string) {
  const { main, attribution, quoted } = splitQuotedText(text);
  const body = `<div style="white-space:pre-wrap">${escapeHtml(main)}</div>`;
  if (!quoted) return body;
  const attr = attribution ? `<div class="gmail_attr">${escapeHtml(attribution)}</div>` : "";
  const quote = `<blockquote type="cite" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex"><div style="white-space:pre-wrap">${escapeHtml(unquote(quoted))}</div></blockquote>`;
  return `${body}<br><div class="gmail_quote">${attr}${quote}</div>`;
}

function boundary() {
  return `nimbox-${crypto.randomUUID()}`;
}

export function buildEml(mail: OutgoingMail) {
  const lines: string[] = [
    `From: ${formatPerson(mail.from)}`,
    `To: ${mail.to.map(formatPerson).join(", ")}`,
  ];
  if (mail.cc.length) lines.push(`Cc: ${mail.cc.map(formatPerson).join(", ")}`);
  if (mail.bcc.length) lines.push(`Bcc: ${mail.bcc.map(formatPerson).join(", ")}`);
  lines.push(`Subject: ${encodeWord(mail.subject)}`);
  lines.push(`Date: ${mail.date.toUTCString().replace("GMT", "+0000")}`);
  lines.push(`Message-ID: ${mail.messageId}`);
  if (mail.inReplyTo) lines.push(`In-Reply-To: ${mail.inReplyTo}`);
  if (mail.references.length) lines.push(`References: ${mail.references.join(" ")}`);
  lines.push("MIME-Version: 1.0");

  const alt = boundary();
  const alternative = [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(utf8Base64(mail.text)),
    `--${alt}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(utf8Base64(mail.html)),
    `--${alt}--`,
  ];

  if (mail.attachments.length === 0) {
    return [...lines, ...alternative, ""].join("\r\n");
  }

  const mixed = boundary();
  const parts = [`Content-Type: multipart/mixed; boundary="${mixed}"`, "", `--${mixed}`, ...alternative];
  for (const file of mail.attachments) {
    const name = encodeWord(file.filename).replace(/"/g, "");
    parts.push(
      `--${mixed}`,
      `Content-Type: ${file.contentType || "application/octet-stream"}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap(file.content.replace(/\s+/g, "")),
    );
  }
  parts.push(`--${mixed}--`);
  return [...lines, ...parts, ""].join("\r\n");
}

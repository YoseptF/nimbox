import { env } from "cloudflare:workers";
import { vi } from "vitest";
import worker from "../src/worker/index";
import type { AppEnv } from "../src/worker/env";

export const appEnv = env as unknown as AppEnv;

export function rawEmail(fields: {
  from: string;
  to: string;
  subject: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  body?: string;
}) {
  const lines = [
    `From: ${fields.from}`,
    `To: ${fields.to}`,
    `Subject: ${fields.subject}`,
    `Message-ID: ${fields.messageId}`,
    "Date: Thu, 05 Nov 2026 10:00:00 +0000",
  ];
  if (fields.inReplyTo) lines.push(`In-Reply-To: ${fields.inReplyTo}`);
  if (fields.references) lines.push(`References: ${fields.references}`);
  lines.push("MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", fields.body ?? "Hello there");
  return lines.join("\r\n");
}

export function fakeMessage(raw: string, envelopeFrom: string, envelopeTo: string) {
  const headerText = raw.split("\r\n\r\n")[0];
  const headers = new Headers();
  for (const line of headerText.split("\r\n")) {
    const at = line.indexOf(":");
    headers.append(line.slice(0, at), line.slice(at + 1).trim());
  }
  const bytes = new TextEncoder().encode(raw);
  return {
    from: envelopeFrom,
    to: envelopeTo,
    headers,
    raw: new Response(bytes).body!,
    rawSize: bytes.length,
    canBeForwarded: true,
    setReject: vi.fn(),
    forward: vi.fn(async () => ({ messageId: "<fwd@test>" })),
    reply: vi.fn(),
  };
}

export async function deliver(raw: string, from: string, to: string) {
  const message = fakeMessage(raw, from, to);
  await worker.email!(message as unknown as ForwardableEmailMessage, appEnv);
  return message;
}

export async function api(path: string, init: RequestInit = {}, host = "http://localhost") {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await worker.fetch!(new Request(`${host}${path}`, { ...init, headers }) as never, appEnv);
  return response;
}

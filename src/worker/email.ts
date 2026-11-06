import { directoryStub, mailboxStub, type AppEnv } from "./env";
import { decodeHeader, looksLikeAttachment, parseAddresses, parseMessageIds } from "./headers";
import { newId } from "./ids";
import type { NewMessage } from "./types";

export function rawKey(mailbox: string, id: string, now = new Date()) {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${mailbox}/${now.getUTCFullYear()}/${month}/${id}.eml`;
}

export async function receiveEmail(message: ForwardableEmailMessage, env: AppEnv) {
  const mailbox = message.to.toLowerCase();
  const now = Date.now();
  const id = newId(now);
  const key = rawKey(mailbox, id, new Date(now));
  const headers = message.headers;

  const raw = await new Response(message.raw).arrayBuffer();
  await env.MAIL.put(key, raw, {
    httpMetadata: { contentType: "message/rfc822" },
    customMetadata: { mailbox, direction: "in" },
  });

  const from = parseAddresses(headers.get("from"))[0] ?? { name: "", address: message.from.toLowerCase() };
  const messageId = parseMessageIds(headers.get("message-id"))[0] ?? `<${id}@nimbox.invalid>`;
  const record: NewMessage = {
    id,
    direction: "in",
    messageId,
    inReplyTo: parseMessageIds(headers.get("in-reply-to"))[0] ?? null,
    references: parseMessageIds(headers.get("references")),
    from,
    to: parseAddresses(headers.get("to")),
    cc: parseAddresses(headers.get("cc")),
    subject: decodeHeader(headers.get("subject")),
    date: now,
    snippet: "",
    size: message.rawSize,
    r2Key: key,
    hasAttachments: looksLikeAttachment(headers.get("content-type")),
    read: false,
  };

  await directoryStub(env).add(mailbox);
  const stub = mailboxStub(env, mailbox);
  const result = await stub.ingest(record);
  if (result.duplicate) await env.MAIL.delete(key);

  const settings = await stub.getSettings();
  if (settings.forwardTo && (message as { canBeForwarded?: boolean }).canBeForwarded !== false) {
    try {
      await message.forward(settings.forwardTo);
    } catch (error) {
      console.error("forward failed", error);
    }
  }
  return result;
}

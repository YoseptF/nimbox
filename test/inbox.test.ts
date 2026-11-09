import { afterEach, describe, expect, it, vi } from "vitest";
import { api, appEnv, deliver, rawEmail } from "./helpers";

afterEach(() => vi.restoreAllMocks());

async function threads(mailbox: string, folder = "inbox") {
  const response = await api(`/api/mailboxes/${encodeURIComponent(mailbox)}/threads?folder=${folder}`);
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string; count: number; unread: number; subject: string; snippet: string }[];
}

describe("receiving", () => {
  it("stores incoming mail and lists it as an unread thread", async () => {
    await deliver(
      rawEmail({ from: "Ana <ana@example.org>", to: "me@example.com", subject: "Lunch?", messageId: "<a1@example.org>" }),
      "ana@example.org",
      "me@example.com",
    );
    const list = await threads("me@example.com");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ subject: "Lunch?", count: 1, unread: 1 });

    const mailboxes = (await (await api("/api/mailboxes")).json()) as { address: string; unread: number }[];
    expect(mailboxes).toContainEqual(expect.objectContaining({ address: "me@example.com", unread: 1 }));

    const stored = await appEnv.MAIL.list({ prefix: "me@example.com/" });
    expect(stored.objects).toHaveLength(1);
  });

  it("groups replies into one thread even when they arrive out of order", async () => {
    const box = "order@example.com";
    await deliver(
      rawEmail({ from: "bo@example.org", to: box, subject: "Re: Plan", messageId: "<b2@example.org>", inReplyTo: "<b1@example.org>", references: "<b1@example.org>" }),
      "bo@example.org",
      box,
    );
    await deliver(rawEmail({ from: "cy@example.org", to: box, subject: "Other", messageId: "<c1@example.org>" }), "cy@example.org", box);
    await deliver(rawEmail({ from: "bo@example.org", to: box, subject: "Plan", messageId: "<b1@example.org>" }), "bo@example.org", box);
    await deliver(
      rawEmail({ from: "bo@example.org", to: box, subject: "Re: Plan", messageId: "<b3@example.org>", references: "<b1@example.org> <b2@example.org>" }),
      "bo@example.org",
      box,
    );
    const list = await threads(box);
    expect(list).toHaveLength(2);
    const plan = list.find((t) => t.count === 3);
    expect(plan).toBeDefined();
  });

  it("ignores a second delivery of the same message", async () => {
    const box = "dupe@example.com";
    const raw = rawEmail({ from: "dee@example.org", to: box, subject: "Once", messageId: "<d1@example.org>" });
    await deliver(raw, "dee@example.org", box);
    await deliver(raw, "dee@example.org", box);
    const list = await threads(box);
    expect(list).toHaveLength(1);
    expect(list[0].count).toBe(1);
    expect((await appEnv.MAIL.list({ prefix: `${box}/` })).objects).toHaveLength(1);
  });

  it("parses the body when opened and fills the snippet", async () => {
    const box = "body@example.com";
    await deliver(
      rawEmail({ from: "eve@example.org", to: box, subject: "Notes", messageId: "<e1@example.org>", body: "First line\r\n> quoted\r\nSecond line" }),
      "eve@example.org",
      box,
    );
    const [thread] = await threads(box);
    const detail = (await (await api(`/api/mailboxes/${box}/threads/${thread.id}`)).json()) as { messages: { id: string }[] };
    const body = (await (await api(`/api/mailboxes/${box}/messages/${detail.messages[0].id}/body`)).json()) as { text: string };
    expect(body.text).toContain("Second line");
    const [after] = await threads(box);
    expect(after.snippet).toBe("First line Second line");
  });

  it("forwards a copy when the mailbox has a forward address", async () => {
    const box = "fwd@example.com";
    await deliver(rawEmail({ from: "fay@example.org", to: box, subject: "One", messageId: "<f1@example.org>" }), "fay@example.org", box);
    const patch = await api(`/api/mailboxes/${box}`, { method: "PATCH", body: JSON.stringify({ forwardTo: "copy@example.net" }) });
    expect(patch.status).toBe(200);
    const message = await deliver(rawEmail({ from: "fay@example.org", to: box, subject: "Two", messageId: "<f2@example.org>" }), "fay@example.org", box);
    expect(message.forward).toHaveBeenCalledWith("copy@example.net");
  });
});

describe("sending", () => {
  it("replies through Brevo with threading headers and files the sent copy in the thread", async () => {
    const box = "send@example.com";
    await deliver(rawEmail({ from: "gus@example.org", to: box, subject: "Question", messageId: "<g1@example.org>" }), "gus@example.org", box);
    const [thread] = await threads(box);
    const detail = (await (await api(`/api/mailboxes/${box}/threads/${thread.id}`)).json()) as { messages: { id: string }[] };

    const realFetch = globalThis.fetch;
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("https://api.brevo.com/")) {
        calls.push({ url, body: JSON.parse(String(init?.body)) });
        return Response.json({ messageId: "<brevo-1@smtp-relay.example>" }, { status: 201 });
      }
      return realFetch(input, init);
    });

    const response = await api(`/api/mailboxes/${box}/send`, {
      method: "POST",
      body: JSON.stringify({ to: "gus@example.org", subject: "Re: Question", text: "Answer", replyTo: detail.messages[0].id }),
    });
    expect(response.status).toBe(201);
    const sent = (await response.json()) as { threadId: string };
    expect(sent.threadId).toBe(thread.id);

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      sender: { email: box },
      to: [{ email: "gus@example.org" }],
      headers: { "In-Reply-To": "<g1@example.org>", References: "<g1@example.org>" },
    });

    const after = await threads(box);
    expect(after).toHaveLength(1);
    expect(after[0].count).toBe(2);
    expect(await threads(box, "sent")).toHaveLength(1);

    const full = (await (await api(`/api/mailboxes/${box}/threads/${thread.id}`)).json()) as {
      messages: { id: string; direction: string; messageId: string }[];
    };
    const out = full.messages.find((m) => m.direction === "out")!;
    expect(out.messageId).toBe("<brevo-1@smtp-relay.example>");
    const raw = await (await api(`/api/mailboxes/${box}/messages/${out.id}/raw`)).text();
    expect(raw).toContain("In-Reply-To: <g1@example.org>");
    expect(raw).toContain("Message-ID: <brevo-1@smtp-relay.example>");

    await deliver(
      rawEmail({ from: "gus@example.org", to: box, subject: "Re: Question", messageId: "<g2@example.org>", inReplyTo: "<brevo-1@smtp-relay.example>" }),
      "gus@example.org",
      box,
    );
    const final = await threads(box);
    expect(final).toHaveLength(1);
    expect(final[0].count).toBe(3);
  });

  it("refuses to send from an unknown mailbox", async () => {
    const response = await api(`/api/mailboxes/nobody@example.com/send`, { method: "POST", body: JSON.stringify({ to: "x@example.org", text: "hi" }) });
    expect(response.status).toBe(404);
  });

  it("refuses cross-origin writes", async () => {
    await api("/api/mailboxes", { method: "POST", body: JSON.stringify({ address: "xo@example.com" }) });
    const response = await api("/api/mailboxes/xo@example.com", {
      method: "PATCH",
      headers: { origin: "https://evil.example" },
      body: JSON.stringify({ displayName: "x" }),
    });
    expect(response.status).toBe(403);
  });
});

describe("deleting", () => {
  it("deletes a conversation and its stored files", async () => {
    const box = "del@example.com";
    await deliver(rawEmail({ from: "hal@example.org", to: box, subject: "Bye", messageId: "<h1@example.org>" }), "hal@example.org", box);
    const [thread] = await threads(box);
    const response = await api(`/api/mailboxes/${box}/threads/${thread.id}`, { method: "DELETE", headers: { "content-type": "application/json" } });
    expect(response.status).toBe(200);
    expect(await threads(box)).toHaveLength(0);
    expect((await appEnv.MAIL.list({ prefix: `${box}/` })).objects).toHaveLength(0);
  });
});

describe("removing an address", () => {
  it("can add the same address again afterwards", async () => {
    await api("/api/mailboxes", { method: "POST", body: JSON.stringify({ address: "keep@again.example" }) });
    await api("/api/mailboxes", { method: "POST", body: JSON.stringify({ address: "gone@again.example" }) });
    await deliver(rawEmail({ from: "a@example.org", to: "gone@again.example", subject: "Hi", messageId: "<again1@example.org>" }), "a@example.org", "gone@again.example");
    expect((await api("/api/mailboxes/gone@again.example", { method: "DELETE", body: "{}" })).status).toBe(200);
    await api("/api/mailboxes", { method: "POST", body: JSON.stringify({ address: "gone@again.example" }) });
    const threads = await api("/api/mailboxes/gone@again.example/threads");
    expect(threads.status).toBe(200);
    expect(await threads.json()).toEqual([]);
  });
});

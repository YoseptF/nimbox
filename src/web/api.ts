import type { Body, Folder, MailboxInfo, Message, Status, Thread } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET") headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, (data as { error?: string }).error ?? `Request failed (${response.status})`);
  return data as T;
}

const box = (address: string) => `/api/mailboxes/${encodeURIComponent(address)}`;

export const api = {
  status: () => request<Status>("/api/status"),
  mailboxes: () => request<MailboxInfo[]>("/api/mailboxes"),
  addMailbox: (address: string) => request<{ address: string }>("/api/mailboxes", { method: "POST", body: JSON.stringify({ address }) }),
  updateMailbox: (address: string, settings: { displayName?: string; forwardTo?: string }) =>
    request<MailboxInfo>(box(address), { method: "PATCH", body: JSON.stringify(settings) }),
  threads: (address: string, folder: Folder, options: { before?: number; q?: string } = {}) => {
    const params = new URLSearchParams({ folder });
    if (options.before) params.set("before", String(options.before));
    if (options.q) params.set("q", options.q);
    return request<Thread[]>(`${box(address)}/threads?${params}`);
  },
  thread: (address: string, id: string) => request<{ thread: Thread; messages: Message[] }>(`${box(address)}/threads/${id}`),
  setRead: (address: string, id: string, read: boolean) =>
    request<{ ok: true }>(`${box(address)}/threads/${id}/read`, { method: "POST", body: JSON.stringify({ read }) }),
  deleteThread: (address: string, id: string) => request<{ ok: true }>(`${box(address)}/threads/${id}`, { method: "DELETE" }),
  body: (address: string, id: string) => request<Body>(`${box(address)}/messages/${id}/body`),
  attachmentUrl: (address: string, id: string, index: number) => `${box(address)}/messages/${id}/attachments/${index}`,
  rawUrl: (address: string, id: string) => `${box(address)}/messages/${id}/raw`,
  send: (
    address: string,
    mail: { to: string; cc: string; bcc: string; subject: string; text: string; replyTo?: string; attachments: { filename: string; contentType: string; content: string }[] },
  ) => request<{ id: string; threadId: string }>(`${box(address)}/send`, { method: "POST", body: JSON.stringify(mail) }),
};

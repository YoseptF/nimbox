import type { MailProvider } from "./mailLinks";
import type { Body, DeviceCode, SetupDomain, SetupState, Folder, GithubState, MailboxInfo, Message, Status, Thread, UpdateState } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET") headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data as { error?: string; code?: string };
    throw new ApiError(response.status, error.error ?? `Request failed (${response.status})`, error.code);
  }
  return data as T;
}

const box = (address: string) => `/api/mailboxes/${encodeURIComponent(address)}`;

export const api = {
  setup: () => request<SetupState>("/api/setup"),
  saveBrevoKey: (key: string) => request<{ ok: true }>("/api/setup/brevo-key", { method: "POST", body: JSON.stringify({ key }) }),
  checkDomain: (domain: string) => request<SetupDomain>("/api/setup/check-domain", { method: "POST", body: JSON.stringify({ domain }) }),
  testEmail: (mailbox: string) =>
    request<{ ok: true; to: string; provider: MailProvider | null }>("/api/setup/test-email", { method: "POST", body: JSON.stringify({ mailbox }) }),
  finishSetup: () => request<{ ok: true }>("/api/setup/done", { method: "POST", body: "{}" }),
  github: () => request<GithubState>("/api/github"),
  connectGithub: () => request<DeviceCode>("/api/github/connect", { method: "POST", body: "{}" }),
  pollGithub: () =>
    request<{ status: "pending" | "expired" | "denied" | "connected"; interval?: number; github: GithubState }>("/api/github/poll", {
      method: "POST",
      body: "{}",
    }),
  chooseRepo: (repo: string) => request<GithubState>("/api/github/repo", { method: "POST", body: JSON.stringify({ repo }) }),
  skipGithub: () => request<GithubState>("/api/github/skip", { method: "POST", body: "{}" }),
  disconnectGithub: () => request<GithubState>("/api/github", { method: "DELETE", body: "{}" }),
  updates: () => request<UpdateState>("/api/updates"),
  applyUpdate: () =>
    request<{ status: "updated" | "up-to-date"; version: string; commit?: string }>("/api/updates/apply", { method: "POST", body: "{}" }),
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

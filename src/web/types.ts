export interface Person {
  name: string;
  address: string;
}

export interface Status {
  access: boolean;
  brevo: boolean;
  authenticated: boolean;
  email: string | null;
  version: string;
}

export interface GithubState {
  enabled: boolean;
  connected: boolean;
  lapsed: boolean;
  skipped: boolean;
  login: string | null;
  repo: string | null;
  candidates: string[];
  installUrl: string;
}

export interface Release {
  version: string;
  tag: string;
  name: string;
  notes: string;
  url: string;
  publishedAt: string;
}

export interface UpdateState {
  current: string;
  latest: Release | null;
  available: boolean;
  pending: { version: string; commit: string; startedAt: number } | null;
}

export interface DeviceCode {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
}

export interface MailboxInfo {
  address: string;
  unread: number;
  displayName: string;
  forwardTo: string;
}

export interface Thread {
  id: string;
  subject: string;
  lastDate: number;
  count: number;
  unread: number;
  hasIn: boolean;
  hasOut: boolean;
  participants: Person[];
  snippet: string;
  hasAttachments: boolean;
  lastMessageId: string;
}

export interface Message {
  id: string;
  threadId: string;
  direction: "in" | "out";
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  from: Person;
  to: Person[];
  cc: Person[];
  subject: string;
  date: number;
  snippet: string;
  size: number;
  hasAttachments: boolean;
  read: boolean;
}

export interface Body {
  html: string;
  text: string;
  date: string;
  replyTo: Person[];
  attachments: { index: number; filename: string; mimeType: string; size: number; inline: boolean }[];
}

export type Folder = "inbox" | "sent" | "all";

export interface Draft {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  text: string;
  replyTo?: string;
}

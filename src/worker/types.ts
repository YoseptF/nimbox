export interface Person {
  name: string;
  address: string;
}

export type Direction = "in" | "out";

export interface NewMessage {
  id: string;
  direction: Direction;
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
  r2Key: string;
  hasAttachments: boolean;
  read: boolean;
}

export interface MessageRow extends Omit<NewMessage, "references"> {
  threadId: string;
  references: string[];
}

export interface ThreadRow {
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
}

export type Folder = "inbox" | "sent" | "all";

export interface MailboxSettings {
  displayName: string;
  forwardTo: string;
}

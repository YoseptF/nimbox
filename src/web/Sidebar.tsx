import { Icon } from "./icons";
import type { Folder, MailboxInfo } from "./types";

const FOLDERS: { id: Folder; label: string; icon: "inbox" | "sent" | "all" }[] = [
  { id: "inbox", label: "Inbox", icon: "inbox" },
  { id: "sent", label: "Sent", icon: "sent" },
  { id: "all", label: "All mail", icon: "all" },
];

export function Sidebar(props: {
  mailboxes: MailboxInfo[];
  mailbox: string;
  folder: Folder;
  email: string | null;
  onMailbox: (address: string) => void;
  onFolder: (folder: Folder) => void;
  onCompose: () => void;
  onSettings: () => void;
}) {
  const current = props.mailboxes.find((m) => m.address === props.mailbox);
  return (
    <nav className="sidebar">
      <button className="compose-button" onClick={props.onCompose} title="Compose (c)">
        <Icon name="pencil" /> Compose
      </button>
      <ul className="folders">
        {FOLDERS.map((f) => (
          <li key={f.id}>
            <button className={props.folder === f.id ? "active" : ""} onClick={() => props.onFolder(f.id)}>
              <Icon name={f.icon} />
              <span>{f.label}</span>
              {f.id === "inbox" && current && current.unread > 0 && <span className="count">{current.unread}</span>}
            </button>
          </li>
        ))}
      </ul>
      {props.mailboxes.length > 1 && (
        <>
          <h2 className="sidebar-heading">Addresses</h2>
          <ul className="folders addresses">
            {props.mailboxes.map((m) => (
              <li key={m.address}>
                <button className={m.address === props.mailbox ? "active" : ""} onClick={() => props.onMailbox(m.address)} title={m.address}>
                  <span className="address">{m.address}</span>
                  {m.unread > 0 && <span className="count">{m.unread}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="sidebar-footer">
        <button className="ghost" onClick={props.onSettings}>
          <Icon name="gear" /> Settings
        </button>
        {props.mailboxes.length === 1 && <div className="muted small ellipsis">{props.mailbox}</div>}
      </div>
    </nav>
  );
}

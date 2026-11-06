import { useState } from "react";
import { api } from "./api";
import { Icon } from "./icons";
import { AddMailbox } from "./Setup";
import type { MailboxInfo, Status } from "./types";

function MailboxSettings({ mailbox, onSaved }: { mailbox: MailboxInfo; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(mailbox.displayName);
  const [forwardTo, setForwardTo] = useState(mailbox.forwardTo);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form
      className="mailbox-settings"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api.updateMailbox(mailbox.address, { displayName, forwardTo });
          setMessage("Saved");
          onSaved();
        } catch (err) {
          setMessage((err as Error).message);
        }
      }}
    >
      <h3>{mailbox.address}</h3>
      <label>
        <span>Your name on sent mail</span>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Doe" />
      </label>
      <label>
        <span>Also forward incoming mail to</span>
        <input type="email" value={forwardTo} onChange={(e) => setForwardTo(e.target.value)} placeholder="Leave empty to keep mail only here" />
      </label>
      <p className="muted small">The forward address must be verified under Email Routing → Destination addresses.</p>
      <div className="row">
        <button className="primary" type="submit">
          Save
        </button>
        {message && <span className="muted small">{message}</span>}
      </div>
    </form>
  );
}

export function Settings(props: { mailboxes: MailboxInfo[]; status: Status; onClose: () => void; onSaved: () => void }) {
  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <header className="dialog-header">
          <h2>Settings</h2>
          <button className="icon-button" onClick={props.onClose} title="Close">
            <Icon name="close" />
          </button>
        </header>
        <section>
          <p className="small">
            Signed in as <b>{props.status.email || "unknown"}</b>. Sending through Brevo is{" "}
            {props.status.brevo ? <b>connected</b> : <b className="error-text">not set up (add the BREVO_API_KEY secret)</b>}.
          </p>
        </section>
        {props.mailboxes.map((m) => (
          <MailboxSettings key={m.address} mailbox={m} onSaved={props.onSaved} />
        ))}
        <section>
          <h3>Add an address</h3>
          <p className="muted small">Addresses appear on their own when mail arrives. Add one here to send from it before that.</p>
          <AddMailbox onAdded={props.onSaved} />
        </section>
      </div>
    </div>
  );
}

import { useState } from "react";
import { api } from "./api";
import { Icon } from "./icons";
import type { CloudflareState, MailboxInfo } from "./types";

export function NewAddressDialog(props: {
  mailboxes: MailboxInfo[];
  cloudflare: CloudflareState | null;
  onClose: () => void;
  onAdded: (address: string) => void;
}) {
  const domain = props.mailboxes[0]?.address.split("@")[1] ?? "";
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ address: string; note: string } | null>(null);
  const local = name.trim().toLowerCase().replace(/@.*$/, "");
  const address = local ? `${local}@${domain}` : "";

  const create = async () => {
    if (!local) return;
    setBusy(true);
    setError(null);
    try {
      const added = await api.addMailbox(address);
      const note = added.routed
        ? "It's ready: mail sent to it arrives here, and you can pick it as the sender when you write."
        : added.routeError
          ? `You can send from it now, but it can't receive mail yet. ${added.routeError}`
          : props.cloudflare?.connected
            ? "You can send from it now. To receive mail at it, finish Receiving on the setup checklist."
            : "You can send from it now. To receive mail at it, connect Cloudflare in Settings, or add a routing rule for it in Cloudflare's Email Routing.";
      setDone({ address: added.address, note });
      props.onAdded(added.address);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="dialog small-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New address">
        <header className="dialog-header">
          <h2>New address</h2>
          <button className="icon-button" onClick={props.onClose} title="Close">
            <Icon name="close" />
          </button>
        </header>
        {done ? (
          <>
            <p>
              <b>{done.address}</b> is added.
            </p>
            <p className="small">{done.note}</p>
            <button className="primary" onClick={props.onClose}>
              Done
            </button>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <p className="small">
              Add another address at {domain ? <b>{domain}</b> : "your domain"}, like <b>promos@</b> or <b>hello@</b>. It gets its own inbox here and you can
              send from it.
            </p>
            <div className="address-input">
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="promos" aria-label="Name before the @" />
              <span className="muted">@{domain}</span>
            </div>
            {error && <p className="error-text small">{error}</p>}
            <div className="row dialog-actions">
              <button className="primary" type="submit" disabled={!local || busy}>
                {busy ? "Adding…" : address ? `Add ${address}` : "Add address"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

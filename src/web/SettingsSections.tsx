import { useEffect, useState } from "react";
import { api } from "./api";
import { ConnectCloudflare } from "./CloudflareUI";
import { AddMailbox } from "./Setup";
import type { CloudflareState, GithubState, MailboxInfo, SessionState } from "./types";

const SESSION_LABELS: Record<string, string> = { "1h": "1 hour", "24h": "1 day", "168h": "1 week", "720h": "1 month" };

export function AddressesSection({ mailboxes, cloudflare, onChanged }: { mailboxes: MailboxInfo[]; cloudflare: CloudflareState | null; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  return (
    <section>
      <h3>Addresses</h3>
      <ul className="address-list">
        {mailboxes.map((m) => (
          <li key={m.address}>
            <span className="ellipsis">{m.address}</span>
            {mailboxes.length > 1 && (
              <button
                className="link small"
                onClick={async () => {
                  if (!confirm(`Remove ${m.address}? Its mail is deleted for good, and new mail to it bounces back to the sender.`)) return;
                  setError(null);
                  try {
                    await api.removeMailbox(m.address);
                    onChanged();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <AddMailbox
        onAdded={() => {
          setNote(
            cloudflare?.connected
              ? "Added. Mail to it now comes to nimbox."
              : "Added. To receive mail at it, connect Cloudflare (below) or add a routing rule for it in Cloudflare's Email Routing.",
          );
          onChanged();
        }}
      />
      {note && <p className="muted small">{note}</p>}
      {error && <p className="error-text small">{error}</p>}
    </section>
  );
}

export function SignInLengthSection() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .session()
      .then(setSession)
      .catch(() => null);
  }, []);
  if (!session?.protected) return null;
  return (
    <section>
      <h3>Sign in again every</h3>
      <select
        value={session.duration ?? "24h"}
        onChange={async (e) => {
          setError(null);
          try {
            setSession(await api.setSession(e.target.value));
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {session.choices.map((c) => (
          <option key={c} value={c}>
            {SESSION_LABELS[c] ?? c}
          </option>
        ))}
        {session.duration && !session.choices.includes(session.duration) && <option value={session.duration}>{session.duration}</option>}
      </select>
      {error && <p className="error-text small">{error}</p>}
    </section>
  );
}

export function CloudflareSection({ cloudflare, onChange }: { cloudflare: CloudflareState | null; onChange: (c: CloudflareState) => void }) {
  if (!cloudflare?.enabled) return null;
  return (
    <section>
      <h3>Cloudflare</h3>
      {cloudflare.connected ? (
        <div className="row">
          <span className="small">
            Connected{cloudflare.accountName ? ` to ${cloudflare.accountName}` : ""}. nimbox manages your addresses and sign-in for you.
          </span>
          <button
            className="link small"
            onClick={async () => {
              if (!confirm("Disconnect Cloudflare? New addresses then need a routing rule made by hand.")) return;
              await api.disconnectCloudflare();
              onChange(await api.cloudflare());
            }}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <>
          <p className="small">
            {cloudflare.lapsed ? "The Cloudflare connection stopped working. " : ""}Connect Cloudflare so nimbox can manage your addresses and sign-in for
            you.
          </p>
          <ConnectCloudflare />
        </>
      )}
    </section>
  );
}

export function UninstallSection({ cloudflare, github }: { cloudflare: CloudflareState | null; github: GithubState | null }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  if (!cloudflare?.enabled) return null;
  const repoUrl = github?.repo ? `https://github.com/${github.repo}/settings` : null;
  if (state === "done") {
    return (
      <section className="danger">
        <h3>nimbox is being removed</h3>
        <p className="small">In a few seconds this page stops working. Three things are left for you, because nimbox has no permission to touch them:</p>
        <ol className="howto small">
          <li>
            Delete your copy on GitHub{repoUrl ? (
              <>
                : <a href={repoUrl}>open its settings</a> and click <b>Delete this repository</b>
              </>
            ) : null}
            .
          </li>
          <li>
            Remove nimbox-updater, if you turned on updates: <a href="https://github.com/settings/installations">GitHub Apps</a>.
          </li>
          <li>
            Delete the Brevo key, if you don't use it elsewhere: <a href="https://app.brevo.com/settings/keys/api">Brevo API keys</a>.
          </li>
        </ol>
      </section>
    );
  }
  return (
    <section className="danger">
      <h3>Remove nimbox</h3>
      {!open ? (
        <button className="link small" onClick={() => setOpen(true)}>
          Remove nimbox and delete all your mail…
        </button>
      ) : !cloudflare.connected ? (
        <>
          <p className="small">Connect Cloudflare first, so nimbox can remove everything it created for you.</p>
          <ConnectCloudflare />
        </>
      ) : (
        <>
          <p className="small">
            This deletes <b>all your mail</b> and removes nimbox from Cloudflare: your address rules, the sign-in protection, the storage with your mail,
            and the app itself. It can't be undone. Mail sent to your addresses afterwards bounces back to the sender.
          </p>
          <p className="small">
            Type <b>delete everything</b> to confirm:
          </p>
          <div className="inline-form">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="delete everything" />
            <button
              className="button-danger"
              disabled={typed !== "delete everything" || state === "working"}
              onClick={async () => {
                setState("working");
                setError(null);
                try {
                  await api.uninstall(typed);
                  setState("done");
                } catch (e) {
                  setError((e as Error).message);
                  setState("idle");
                }
              }}
            >
              {state === "working" ? "Removing…" : "Remove nimbox"}
            </button>
          </div>
          {error && <p className="error-text small">{error}</p>}
        </>
      )}
    </section>
  );
}

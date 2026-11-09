import { useEffect, useState } from "react";
import { api } from "./api";
import type { CloudflareState, ReceivingStatus } from "./types";

const RETURN_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Cloudflare is connected." },
  cancelled: { ok: false, text: "You cancelled on Cloudflare, so nothing changed." },
  "wrong-account": {
    ok: false,
    text: "That Cloudflare account doesn't run this nimbox. Connect again and pick the account you deployed nimbox to.",
  },
  failed: { ok: false, text: "Connecting Cloudflare didn't finish. Try again." },
};

export function takeCloudflareReturn() {
  const params = new URLSearchParams(location.search);
  const value = params.get("cloudflare");
  if (!value) return null;
  params.delete("cloudflare");
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  return RETURN_MESSAGES[value] ?? null;
}

export function ReturnNotice({ notice }: { notice: { ok: boolean; text: string } | null }) {
  if (!notice) return null;
  return <div className={`banner ${notice.ok ? "" : "error"}`}>{notice.text}</div>;
}

export function ConnectCloudflare({ label = "Connect Cloudflare" }: { label?: string }) {
  return (
    <a className="primary button-link" href="/api/cloudflare/connect">
      {label}
    </a>
  );
}

export function TurnOnSignIn({ cloudflare, highlight = false }: { cloudflare: CloudflareState; highlight?: boolean }) {
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  if (!cloudflare.connected) {
    return (
      <div className="github-connect">
        <p>Connect Cloudflare and nimbox turns on the sign-in for you. Cloudflare asks which account to use: pick the one you deployed nimbox to.</p>
        <ConnectCloudflare />
      </div>
    );
  }
  if (state === "done") {
    return (
      <div className="github-connect">
        <p>Sign-in protection is on. Reload this page and sign in with the email of your Cloudflare account.</p>
        <button className="primary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
  return (
    <div className="github-connect">
      <p>Cloudflare is connected. One click turns on the sign-in, so only people in your Cloudflare account can open nimbox.</p>
      <button
        className={`primary ${highlight && state === "idle" ? "attention" : ""}`}
        disabled={state === "working"}
        onClick={async () => {
          setState("working");
          setError(null);
          try {
            await api.protectWithCloudflare();
            setState("done");
          } catch (e) {
            setError((e as Error).message);
            setState("idle");
          }
        }}
      >
        {state === "working" ? "Turning it on…" : "Turn on sign-in"}
      </button>
      {error && <p className="error-text small">{error}</p>}
    </div>
  );
}

function domainDone(r: ReceivingStatus) {
  return r.zone && r.enabled && r.missing.length === 0 && r.elsewhere.length === 0;
}

export function receivingDone(list: ReceivingStatus[] | null) {
  return Boolean(list && list.length > 0 && list.every(domainDone));
}

export function ReceivingPanel({ addresses, onChange }: { addresses: string[]; onChange?: (list: ReceivingStatus[]) => void }) {
  const [list, setList] = useState<ReceivingStatus[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const addressKey = addresses.join(",");

  const load = async () => {
    setChecking(true);
    setError(null);
    try {
      const next = await api.receiving();
      setList(Array.isArray(next) ? next : []);
      onChange?.(Array.isArray(next) ? next : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    load();
  }, [addressKey]);

  const checkAgain = (
    <button onClick={load} disabled={checking}>
      {checking ? "Checking…" : "Check again"}
    </button>
  );

  if (addresses.length === 0) {
    return <p>Add your email address in the step above first. Then nimbox can send its mail here.</p>;
  }

  const run = async (domain: string, approve: string[]) => {
    setBusy(domain);
    setError(null);
    try {
      await api.setUpReceiving(domain, approve);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!list) {
    return error ? (
      <>
        <p className="error-text small">{error}</p>
        {checkAgain}
      </>
    ) : (
      <p className="muted">Checking your domain…</p>
    );
  }

  if (list.length === 0) {
    return (
      <>
        <p>nimbox couldn't find your address yet. Check again in a moment.</p>
        {checkAgain}
      </>
    );
  }

  return (
    <>
      {list.map((r) => {
        if (!r.zone) {
          return (
            <p key={r.domain}>
              <b>{r.domain}</b> isn't in the Cloudflare account you connected. Add it to that account first, or connect the account that has it.
            </p>
          );
        }
        if (domainDone(r)) {
          return (
            <p key={r.domain}>
              Mail for <b>{r.domain}</b> comes to nimbox.
            </p>
          );
        }
        if (!r.enabled && r.conflicts.length > 0) {
          return (
            <div key={r.domain}>
              <p>
                <b>{r.domain}</b> still sends its mail to another service. To bring it here, nimbox will delete these old records and turn on
                Cloudflare's Email Routing:
              </p>
              <table className="old-records">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Content</th>
                  </tr>
                </thead>
                <tbody>
                  {r.conflicts.map((c) => (
                    <tr key={c.id}>
                      <td>{c.type}</td>
                      <td className="wrap">
                        <code>{c.content}</code>
                        {c.priority !== undefined ? <span className="muted small"> (priority {c.priority})</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">From then on, mail for {r.domain} stops going to the old service. Every other record stays as it is.</p>
              <button
                className="primary"
                disabled={busy !== null}
                onClick={() => {
                  if (confirm(`Delete the old mail records of ${r.domain} and bring its mail to nimbox?`)) run(r.domain, r.conflicts.map((c) => c.id));
                }}
              >
                {busy === r.domain ? "Working…" : "Delete them and set it up"}
              </button>
            </div>
          );
        }
        const addresses = [...r.missing, ...r.elsewhere];
        return (
          <div key={r.domain}>
            <p>
              {r.enabled ? (
                <>
                  Ready to send {addresses.map((a, i) => (
                    <span key={a}>
                      {i > 0 ? ", " : ""}
                      <b>{a}</b>
                    </span>
                  ))}{" "}
                  to nimbox.
                </>
              ) : (
                <>
                  Ready to turn on Cloudflare's Email Routing for <b>{r.domain}</b> and send your addresses to nimbox.
                </>
              )}
            </p>
            <button className="primary" disabled={busy !== null} onClick={() => run(r.domain, [])}>
              {busy === r.domain ? "Working…" : "Set it up"}
            </button>
          </div>
        );
      })}
      {error && <p className="error-text small">{error}</p>}
    </>
  );
}

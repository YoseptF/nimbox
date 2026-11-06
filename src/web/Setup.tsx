import { useState } from "react";
import { api } from "./api";
import { GithubConnect, githubReady } from "./GithubConnect";
import type { GithubState, Status } from "./types";

function Step({ done, title, children }: { done?: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className={done ? "step done" : "step"}>
      <span className="step-mark">{done ? "✓" : ""}</span>
      <div>
        <h3>{title}</h3>
        {!done && children}
      </div>
    </li>
  );
}

export function AddMailbox({ onAdded }: { onAdded: () => void }) {
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api.addMailbox(address.trim());
          setAddress("");
          setError(null);
          onAdded();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <input type="email" placeholder="you@yourdomain.com" value={address} onChange={(e) => setAddress(e.target.value)} required />
      <button className="primary" type="submit">
        Add address
      </button>
      {error && <span className="error-text">{error}</span>}
    </form>
  );
}

export function Setup({
  status,
  hasMailboxes,
  github,
  onMailboxAdded,
  onGithub,
}: {
  status: Status;
  hasMailboxes?: boolean;
  github?: GithubState | null;
  onMailboxAdded?: () => void;
  onGithub?: (github: GithubState) => void;
}) {
  const host = location.host;
  return (
    <div className="setup">
      <h1>Finish setting up nimbox</h1>
      <p className="muted">A few steps happen in the Cloudflare and Brevo dashboards. This page updates when you reload it.</p>
      <ol className="steps">
        <Step done={status.access} title="Put Cloudflare Access in front of this app">
          <p>
            In the Cloudflare dashboard open <b>Workers &amp; Pages</b>, select this Worker, open the <b>Access</b> tab and choose{" "}
            <b>Protect this Worker behind Access</b> with <b>All traffic</b>. Allow only your own email.
          </p>
          <p>
            Then copy the <b>Application Audience (AUD) tag</b> (Zero Trust → Access → Applications → Edit) and your team name (Zero Trust →
            Settings), and add them in the Worker under <b>Settings → Variables and Secrets</b> as secrets:
          </p>
          <pre>{`ACCESS_TEAM_DOMAIN = yourteam.cloudflareaccess.com\nACCESS_AUD         = <the AUD tag>`}</pre>
          <p className="muted">Until both are set, the app refuses to show any mail.</p>
        </Step>
        {status.access && !status.authenticated && (
          <Step title="Sign in through Access">
            <p>
              Access is set up, but this request did not carry a valid Access sign-in. Check that the Access application covers <b>{host}</b> and that{" "}
              <code>ACCESS_AUD</code> matches that application, then reload.
            </p>
          </Step>
        )}
        <Step done={status.brevo} title="Connect Brevo for sending">
          <p>
            In Brevo, add your domain under <b>Senders, Domains &amp; Dedicated IPs → Domains</b> and add the DNS records it shows (DKIM and DMARC) in
            Cloudflare DNS. Create an API key under <b>SMTP &amp; API → API Keys</b>: choose <b>Restricted</b> access, set <b>Transactional email</b> to{" "}
            <b>All</b>, leave the rest on <b>None</b>, and pick the longest expiry. Save it in the Worker as the secret <code>BREVO_API_KEY</code>.
          </p>
        </Step>
        {status.authenticated && (
          <Step done={hasMailboxes} title="Route your mail to this Worker">
            <p>
              In the Cloudflare dashboard open your domain, go to <b>Email → Email Routing → Routing rules</b>, and create a rule (or the catch-all)
              with the action <b>Send to a Worker</b> pointing to this Worker. Mail for that address shows up here as soon as it arrives.
            </p>
            <p>You can also add an address now to start sending from it:</p>
            {onMailboxAdded && <AddMailbox onAdded={onMailboxAdded} />}
          </Step>
        )}
        {status.authenticated && github?.enabled && onGithub && (
          <Step done={githubReady(github)} title="Turn on one-click updates">
            <p>Connect GitHub once so nimbox can install its own updates with one click later.</p>
            <GithubConnect github={github} onChange={onGithub} />
            {!github.connected && (
              <button className="link small skip" onClick={async () => onGithub(await api.skipGithub())}>
                Skip for now
              </button>
            )}
          </Step>
        )}
      </ol>
    </div>
  );
}

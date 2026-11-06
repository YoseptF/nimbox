import { useState } from "react";
import { api } from "./api";
import { GithubConnect, githubReady } from "./GithubConnect";
import { Icon } from "./icons";
import { AddressesSection, CloudflareSection, SignInLengthSection, UninstallSection } from "./SettingsSections";
import type { CloudflareState, GithubState, MailboxInfo, Status } from "./types";

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
          const saved = await api.updateMailbox(mailbox.address, { displayName, forwardTo });
          setMessage(
            saved.forwardStatus === "sent"
              ? `Saved. Cloudflare sent a confirmation email to ${saved.forwardTo}: click the link in it, and forwarding starts.`
              : saved.forwardStatus === "manual"
                ? `Saved. Forwarding starts once ${saved.forwardTo} is confirmed under Email Routing → Destination addresses in Cloudflare (or connect Cloudflare below and save again).`
                : "Saved",
          );
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
      <div className="row">
        <button className="primary" type="submit">
          Save
        </button>
        {message && <span className="muted small">{message}</span>}
      </div>
    </form>
  );
}

function Updates({ status, github, onGithub }: { status: Status; github: GithubState | null; onGithub: (github: GithubState) => void }) {
  return (
    <section className="updates-settings">
      <h3>Updates</h3>
      <p className="small">This is nimbox {status.version}.</p>
      {github?.enabled &&
        (githubReady(github) ? (
          <div className="row">
            <GithubConnect github={github} onChange={onGithub} />
            <button
              className="link small"
              onClick={async () => {
                if (confirm("Disconnect GitHub? Updates will ask you to connect again.")) onGithub(await api.disconnectGithub());
              }}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="turn-on">
            <p className="small">
              <b>Turn on updates.</b> Connect GitHub once so nimbox can install its own updates with one click.
            </p>
            <GithubConnect github={github} onChange={onGithub} />
          </div>
        ))}
    </section>
  );
}

export function Settings(props: {
  mailboxes: MailboxInfo[];
  status: Status;
  github: GithubState | null;
  onGithub: (github: GithubState) => void;
  cloudflare: CloudflareState | null;
  onCloudflare: (cloudflare: CloudflareState) => void;
  onClose: () => void;
  onSaved: () => void;
  onOpenSetup: () => void;
}) {
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
            {props.status.brevo ? <b>connected</b> : <b className="error-text">not set up yet</b>}.{" "}
            <button className="link" onClick={props.onOpenSetup}>
              Open the setup checklist
            </button>
          </p>
        </section>
        <Updates status={props.status} github={props.github} onGithub={props.onGithub} />
        <AddressesSection mailboxes={props.mailboxes} cloudflare={props.cloudflare} onChanged={props.onSaved} />
        {props.mailboxes.map((m) => (
          <MailboxSettings key={m.address} mailbox={m} onSaved={props.onSaved} />
        ))}
        {props.cloudflare?.connected && <SignInLengthSection />}
        <CloudflareSection cloudflare={props.cloudflare} onChange={props.onCloudflare} />
        <UninstallSection cloudflare={props.cloudflare} github={props.github} />
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "./api";
import { GithubConnect, githubReady } from "./GithubConnect";
import type { GithubState, MailboxInfo, SetupState, Status } from "./types";

const CF_WORKERS = "https://dash.cloudflare.com/?to=/:account/workers-and-pages";
const CF_EMAIL_ROUTING = "https://dash.cloudflare.com/?to=/:account/email-service/routing";
const CF_DNS = "https://dash.cloudflare.com/?to=/:account/:zone/dns/records";
const BREVO_SIGNUP = "https://www.brevo.com";
const BREVO_KEYS = "https://app.brevo.com/settings/keys/api";
const BREVO_DOMAINS = "https://app.brevo.com/senders/domain/list";

export function workerName() {
  const host = location.hostname;
  return host.endsWith(".workers.dev") ? host.split(".")[0] : null;
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Value({ value }: { value: string }) {
  return (
    <span className="value">
      <code>{value}</code>
      <CopyButton value={value} />
    </span>
  );
}

function Card({ n, done, title, children }: { n: number; done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <section className={`card ${done ? "done" : ""}`}>
      <header>
        <span className="badge">{done ? "✓" : n}</span>
        <h2>{title}</h2>
        <span className={`pill ${done ? "ok" : ""}`}>{done ? "Done" : "To do"}</span>
      </header>
      {children && <div className="card-body">{children}</div>}
    </section>
  );
}

function OpenLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="open-link" href={href} target="_blank" rel="noopener">
      {children} ↗
    </a>
  );
}

export function AddMailbox({ onAdded, label = "Add address" }: { onAdded: () => void; label?: string }) {
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
        {label}
      </button>
      {error && <span className="error-text small">{error}</span>}
    </form>
  );
}

export function BrevoKeyForm({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api.saveBrevoKey(key);
          setKey("");
          setError(null);
          onSaved();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <input type="password" autoComplete="off" placeholder="Paste your Brevo key" value={key} onChange={(e) => setKey(e.target.value)} required />
      <button className="primary" type="submit">
        Save
      </button>
      {error && <span className="error-text small">{error}</span>}
    </form>
  );
}

function SignInCard() {
  const name = workerName();
  return (
    <div className="setup">
      <div className="setup-hero">
        <div className="logo">✉</div>
        <h1>One step before your inbox</h1>
        <p>nimbox keeps your mail private by asking you to sign in first. That protection is not on yet, so nothing is shown.</p>
      </div>
      <section className="card">
        <div className="card-body solo">
          <ol className="howto">
            <li>
              <OpenLink href={CF_WORKERS}>Open Workers &amp; Pages in Cloudflare</OpenLink>
            </li>
            <li>Click {name ? <b>{name}</b> : "your nimbox app"}, then the <b>Access</b> tab.</li>
            <li>
              Choose <b>Protect this Worker behind Access</b>, pick <b>All traffic</b>, and as the policy pick <b>Cloudflare account</b>.
            </li>
          </ol>
          <p className="muted small">
            Turned on protection while deploying? Check that it says <b>All traffic</b>, not <b>Previews only</b>.
          </p>
          <button className="primary" onClick={() => location.reload()}>
            Check again
          </button>
        </div>
      </section>
    </div>
  );
}

export function Setup(props: {
  status: Status;
  mailboxes: MailboxInfo[];
  github: GithubState | null;
  onMailboxes: () => void;
  onStatus: () => void;
  onGithub: (github: GithubState) => void;
  onDone: () => void;
}) {
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [checking, setChecking] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    setChecking(true);
    try {
      setSetup(await api.setup());
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (props.status.authenticated) load();
  }, [props.status.authenticated, props.mailboxes.length, props.status.brevo]);

  if (!props.status.authenticated) return <SignInCard />;

  const address = props.mailboxes[0]?.address ?? "";
  const local = address.split("@")[0];
  const domain = address.split("@")[1] ?? "";
  const name = workerName();
  const sendingReady = Boolean(setup?.brevo.connected && setup.domains.length > 0 && setup.domains.every((d) => d.state === "verified"));

  const checkDomain = async (d: string) => {
    setChecking(true);
    try {
      const updated = await api.checkDomain(d);
      setSetup((s) => (s ? { ...s, domains: s.domains.map((x) => (x.domain === d ? updated : x)) } : s));
    } finally {
      setChecking(false);
    }
  };

  const sendTest = async () => {
    setTestResult(null);
    try {
      await api.testEmail(address);
      setTestResult({ ok: true, text: `Sent to ${address}. If receiving is set up, it shows up in your inbox in a few seconds.` });
      setTimeout(load, 8000);
    } catch (e) {
      setTestResult({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <div className="setup">
      <div className="setup-hero">
        <div className="logo">✉</div>
        <h1>Set up nimbox</h1>
        <p>A few short steps and your inbox is ready. You can come back here anytime from Settings.</p>
      </div>

      <Card n={1} done title="Private sign-in">
        <p className="muted small">Only you can open nimbox{props.status.email ? ` (signed in as ${props.status.email})` : ""}.</p>
      </Card>

      <Card n={2} done={props.mailboxes.length > 0} title="Your email address">
        {props.mailboxes.length > 0 ? (
          <p>
            Your address is <b>{address}</b>
            {props.mailboxes.length > 1 ? ` (and ${props.mailboxes.length - 1} more)` : ""}.
          </p>
        ) : (
          <>
            <p>Which address on your domain do you want to use?</p>
            <AddMailbox onAdded={props.onMailboxes} label="Use this address" />
          </>
        )}
      </Card>

      <Card n={3} done={sendingReady} title="Sending">
        {!setup ? (
          <p className="muted">Checking…</p>
        ) : !setup.brevo.connected ? (
          <>
            <p>nimbox sends your mail through Brevo, a free email service (300 emails a day).</p>
            <ol className="howto">
              <li>
                <OpenLink href={BREVO_SIGNUP}>Create a free Brevo account</OpenLink> if you don't have one.
              </li>
              <li>
                <OpenLink href={BREVO_KEYS}>Open Brevo's API keys page</OpenLink> and click <b>Generate new API Key</b>. Choose <b>Restricted</b>, set{" "}
                <b>Transactional email</b> to <b>All</b>, leave the rest on <b>None</b>, and pick the longest expiry.
              </li>
              <li>Copy the key and paste it here:</li>
            </ol>
            <BrevoKeyForm onSaved={props.onStatus} />
          </>
        ) : (
          <>
            {setup.domains.length === 0 && <p className="muted">Add your address in step 2 first.</p>}
            {setup.domains.some((d) => d.state === "badkey") && (
              <div className="banner error">
                Brevo did not accept the saved key. Create a new key on <OpenLink href={BREVO_KEYS}>Brevo's API keys page</OpenLink> (Restricted,
                Transactional email set to All) and paste it here:
                <BrevoKeyForm onSaved={load} />
              </div>
            )}
            {setup.domains.filter((d) => d.state !== "badkey").map((d) =>
              d.state === "verified" ? (
                <p key={d.domain}>
                  <b>{d.domain}</b> is ready to send.
                </p>
              ) : d.state === "pending" ? (
                <div key={d.domain} className="records">
                  <p>
                    Brevo needs to confirm you own <b>{d.domain}</b>. <OpenLink href={CF_DNS}>Open your domain's DNS records in Cloudflare</OpenLink>, pick{" "}
                    <b>{d.domain}</b>, and add these records (click <b>Add record</b> for each, type <b>{d.records[0]?.type ?? "TXT"}</b>):
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Content</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.records.map((r, i) => (
                        <tr key={i}>
                          <td>
                            <Value value={r.name} />
                          </td>
                          <td className="wrap">
                            <Value value={r.value} />
                          </td>
                          <td>{r.ok ? <span className="pill ok">Found</span> : <span className="pill">Missing</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button onClick={() => checkDomain(d.domain)} disabled={checking}>
                    {checking ? "Checking…" : "Check again"}
                  </button>
                  <p className="muted small">New records can take a few minutes to show up.</p>
                </div>
              ) : (
                <div key={d.domain}>
                  <p>
                    <OpenLink href={BREVO_DOMAINS}>Open your domains in Brevo</OpenLink>, add <b>{d.domain}</b>,
                    and follow Brevo's steps to confirm it. Then come back and send a test email.
                  </p>
                </div>
              ),
            )}
            {address && !setup.domains.some((d) => d.state === "badkey") && (
              <div className="row test">
                <button onClick={sendTest}>Send me a test email</button>
                {testResult && <span className={testResult.ok ? "small" : "error-text small"}>{testResult.text}</span>}
              </div>
            )}
          </>
        )}
      </Card>

      <Card n={4} done={Boolean(setup?.received)} title="Receiving">
        {setup?.received ? (
          <p>Mail is arriving in nimbox.</p>
        ) : (
          <>
            <p>Tell Cloudflare to deliver your mail to nimbox:</p>
            <ol className="howto">
              <li>
                <OpenLink href={CF_EMAIL_ROUTING}>Open Email Routing in Cloudflare</OpenLink>
                {domain ? (
                  <>
                    {" "}
                    and pick <b>{domain}</b>
                  </>
                ) : null}
                . If it asks, turn Email Routing on.
              </li>
              <li>
                Open <b>Routing rules</b> and click <b>Create routing rule</b>.
              </li>
              <li>
                <div className="fields">
                  <span>Email address</span> {local ? <Value value={local} /> : <i>your address</i>}
                  <span>Action</span> <b>Send to a Worker</b>
                  <span>Worker</span> {name ? <Value value={name} /> : <b>your nimbox app</b>}
                </div>
                Then click <b>Save</b>.
              </li>
            </ol>
            <p className="muted small">Cloudflare stops sending this domain's mail to any old forwarding service once Email Routing is on.</p>
            <button onClick={load} disabled={checking}>
              {checking ? "Checking…" : "Check again"}
            </button>
          </>
        )}
      </Card>

      {props.github?.enabled && (
        <Card n={5} done={githubReady(props.github)} title="One-click updates (optional)">
          <p>Connect GitHub once so nimbox can install its own updates with one click later.</p>
          <GithubConnect github={props.github} onChange={props.onGithub} />
        </Card>
      )}

      <div className="setup-footer">
        <button className="primary big" disabled={props.mailboxes.length === 0} onClick={props.onDone}>
          Open my inbox
        </button>
        {props.mailboxes.length === 0 && <span className="muted small">Add your address first.</span>}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "./api";
import { GithubConnect, githubReady } from "./GithubConnect";
import { mailLink } from "./mailLinks";
import { ConnectCloudflare, ReceivingPanel, receivingDone, ReturnNotice, TurnOnSignIn } from "./CloudflareUI";
import type { CloudflareState, GithubState, MailboxInfo, ReceivingStatus, SetupState, Status } from "./types";

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
          const added = await api.addMailbox(address.trim());
          setAddress("");
          setError(added.routeError ? `Added, but nimbox couldn't send it to your inbox yet. ${added.routeError}` : null);
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

function ManualSignIn() {
  const name = workerName();
  return (
    <>
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
    </>
  );
}

function SignInCard({ cloudflare, notice }: { cloudflare: CloudflareState | null; notice: { ok: boolean; text: string } | null }) {
  const [manual, setManual] = useState(false);
  const automatic = Boolean(cloudflare?.enabled);
  return (
    <div className="setup">
      <div className="setup-hero">
        <div className="logo">✉</div>
        <h1>One step before your inbox</h1>
        <p>nimbox keeps your mail private by asking you to sign in first. That protection is not on yet, so nothing is shown.</p>
      </div>
      <ReturnNotice
        notice={notice?.ok && cloudflare?.connected ? { ok: true, text: "Cloudflare is connected. One more click below turns on the sign-in." } : notice}
      />
      <section className="card">
        <div className="card-body solo">
          {automatic && !manual ? (
            <>
              <TurnOnSignIn cloudflare={cloudflare!} highlight={Boolean(notice?.ok)} />
              <button className="link small skip" onClick={() => setManual(true)}>
                I'd rather do it in the Cloudflare dashboard
              </button>
            </>
          ) : (
            <ManualSignIn />
          )}
        </div>
      </section>
    </div>
  );
}

export function Setup(props: {
  status: Status;
  cloudflare: CloudflareState | null;
  notice: { ok: boolean; text: string } | null;
  mailboxes: MailboxInfo[];
  github: GithubState | null;
  onMailboxes: () => void;
  onStatus: () => void;
  onGithub: (github: GithubState) => void;
  onDone: () => void;
}) {
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [checking, setChecking] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string; link?: { label: string; href: string } | null } | null>(null);

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

  const [receiving, setReceiving] = useState<ReceivingStatus[] | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  if (!props.status.authenticated) return <SignInCard cloudflare={props.cloudflare} notice={props.notice} />;
  const connected = Boolean(props.cloudflare?.connected);

  const address = props.mailboxes[0]?.address ?? "";
  const local = address.split("@")[0];
  const domain = address.split("@")[1] ?? "";
  const name = workerName();
  const oldRecords = setup?.mailRecords.find((r) => r.domain === domain)?.remove ?? [];
  const sendingReady = Boolean(
    setup?.brevo.connected && (setup.brevo.sendVerified || (setup.domains.length > 0 && setup.domains.every((d) => d.state === "verified"))),
  );

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
      const sent = await api.testEmail(address);
      setTestResult({ ok: true, text: `Sent. Check ${sent.to} for an email from ${address}.`, link: mailLink(sent.provider, sent.to, address) });
      setSetup((current) => (current ? { ...current, brevo: { ...current.brevo, sendVerified: true } } : current));
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
      <ReturnNotice notice={props.notice} />

      <Card n={1} done title="Private sign-in">
        <p className="muted small">Only you can open nimbox{props.status.email ? ` (signed in as ${props.status.email})` : ""}.</p>
      </Card>

      {props.cloudflare?.enabled && (
        <Card n={2} done={connected} title="Connect Cloudflare">
          {connected ? (
            <p className="muted small">
              Connected{props.cloudflare.accountName ? ` to ${props.cloudflare.accountName}` : ""}. nimbox can now set up your domain's mail for you.
            </p>
          ) : (
            <>
              <p>So nimbox can set up your domain's mail for you, instead of you clicking through Cloudflare's dashboard.</p>
              <ConnectCloudflare />
              <p className="muted small">Cloudflare shows what nimbox may change and asks which account to use: pick the one you deployed nimbox to.</p>
            </>
          )}
        </Card>
      )}

      <Card n={props.cloudflare?.enabled ? 3 : 2} done={props.mailboxes.length > 0} title="Your email address">
        {props.mailboxes.length > 0 ? (
          <>
            <p>
              Your address is <b>{address}</b>
              {props.mailboxes.length > 1 ? ` (and ${props.mailboxes.length - 1} more)` : ""}.
            </p>
            <p className="muted small">
              It's where your mail arrives and what people see when you send. You only need one to start: add more, like promos@, any time from{" "}
              <b>+ New address</b> in the sidebar.
            </p>
          </>
        ) : (
          <>
            <p>Which address on your domain do you want to start with?</p>
            <p className="muted small">
              It's where your mail arrives and what people see when you send. One is enough for now: you can add more, like promos@ or hello@, any time
              from the sidebar.
            </p>
            <AddMailbox onAdded={props.onMailboxes} label="Use this address" />
          </>
        )}
      </Card>

      <Card n={props.cloudflare?.enabled ? 4 : 3} done={sendingReady} title="Sending">
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
                <b>Transactional email</b> to <b>All</b> and <b>Account</b> to <b>Read</b> (so nimbox can see when your domain is ready), leave the rest
                on <b>None</b>, and pick the longest expiry.
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
                Transactional email set to All, Account set to Read) and paste it here:
                <BrevoKeyForm onSaved={load} />
              </div>
            )}
            {setup.domains.filter((d) => d.state !== "badkey").map((d) =>
              d.state === "verified" ? (
                <p key={d.domain}>
                  <b>{d.domain}</b> is ready to send.
                </p>
              ) : d.state === "pending" && connected ? (
                <div key={d.domain} className="records">
                  <p>
                    Brevo needs a few records in <b>{d.domain}</b>'s DNS to confirm it's yours. nimbox can add them for you.
                  </p>
                  <button
                    className="primary"
                    disabled={writing !== null}
                    onClick={async () => {
                      setWriting(d.domain);
                      setWriteError(null);
                      try {
                        const updated = await api.writeBrevoRecords(d.domain);
                        setSetup((cur) => (cur ? { ...cur, domains: cur.domains.map((x) => (x.domain === d.domain ? updated : x)) } : cur));
                      } catch (e) {
                        setWriteError((e as Error).message);
                      } finally {
                        setWriting(null);
                      }
                    }}
                  >
                    {writing === d.domain ? "Adding…" : "Add them for me"}
                  </button>{" "}
                  <button onClick={() => checkDomain(d.domain)} disabled={checking}>
                    {checking ? "Checking…" : "Check again"}
                  </button>
                  {writeError && <p className="error-text small">{writeError}</p>}
                  <p className="muted small">Brevo can take a few minutes to see new records. Every other record stays as it is.</p>
                </div>
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
              ) : setup.brevo.sendVerified ? (
                <p key={d.domain}>
                  Sending from <b>{d.domain}</b> works: Brevo accepted your email.
                </p>
              ) : (
                <div key={d.domain}>
                  <p>
                    <OpenLink href={BREVO_DOMAINS}>Open your domains in Brevo</OpenLink>, add <b>{d.domain}</b>,
                    and follow Brevo's steps to confirm it. Then come back and send a test email.
                  </p>
                </div>
              ),
            )}
            {address && props.status.email && !setup.domains.some((d) => d.state === "badkey") && (
              <div className="row test">
                <span className="small">
                  We'll send a test from <b>{address}</b> to <b>{props.status.email}</b>.
                </span>
                <button onClick={sendTest}>Send test email</button>
                {testResult && <span className={testResult.ok ? "small" : "error-text small"}>{testResult.text}</span>}
                {testResult?.link && (
                  <a className="primary button-link" href={testResult.link.href} target="_blank" rel="noopener">
                    {testResult.link.label}
                  </a>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      <Card n={props.cloudflare?.enabled ? 5 : 4} done={Boolean(setup?.received) || (connected && receivingDone(receiving))} title="Receiving">
        {setup?.received ? (
          <p>Mail is arriving in nimbox.</p>
        ) : connected ? (
          <ReceivingPanel addresses={props.mailboxes.map((m) => m.address)} onChange={setReceiving} />
        ) : (
          <>
            <p>Tell Cloudflare to deliver your mail to nimbox:</p>
            <ol className="howto">
              {oldRecords.length > 0 && (
                <li>
                  Your domain still points its mail somewhere else, and Cloudflare won't take over until that's gone.{" "}
                  <OpenLink href={CF_DNS}>Open your DNS records in Cloudflare</OpenLink>, pick {domain ? <b>{domain}</b> : "your domain"}, and delete exactly
                  these records:
                  <table className="old-records">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Name</th>
                        <th>Content</th>
                      </tr>
                    </thead>
                    <tbody>
                      {oldRecords.map((r, i) => (
                        <tr key={i}>
                          <td>{r.type}</td>
                          <td>{r.name === "@" ? domain : r.name}</td>
                          <td className="wrap">
                            <code>{r.content}</code>
                            {r.priority !== undefined ? <span className="muted small"> (priority {r.priority})</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <span className="muted small">
                    Leave every other record alone, including Brevo's code, DMARC and any site verification records. A domain can only have one SPF
                    record, so the old one goes; Cloudflare adds its own.
                  </span>
                </li>
              )}
              <li>
                <OpenLink href={CF_EMAIL_ROUTING}>Open Email Routing in Cloudflare</OpenLink> and click <b>Onboard Domain</b>. If{" "}
                {domain ? <b>{domain}</b> : "your domain"} is already listed there, click it instead and go straight to <b>Routing Rules</b>.
              </li>
              <li>
                Choose {domain ? <b>{domain}</b> : "your domain"} and click <b>Done</b> (or <b>Activate</b>). Cloudflare adds the records that bring your mail
                to it. From this moment, mail for {domain ? <b>{domain}</b> : "your domain"} no longer goes to any old forwarding service.
              </li>
              <li>
                Open <b>Routing Rules</b> and click <b>Create routing rule</b>:
                <div className="fields">
                  <span>Email pattern</span> {local ? <Value value={local} /> : <i>your address</i>}
                  <span>Action</span> <b>Send to a Worker</b>
                  <span>Worker</span> {name ? <Value value={name} /> : <b>your nimbox app</b>}
                </div>
                Then click <b>Save</b>.
              </li>
            </ol>
            <p className="muted small">More addresses can be added later in Settings, each with its own routing rule.</p>
            <button onClick={load} disabled={checking}>
              {checking ? "Checking…" : "Check again"}
            </button>
          </>
        )}
      </Card>

      {props.github?.enabled && (
        <Card n={props.cloudflare?.enabled ? 6 : 5} done={githubReady(props.github)} title="One-click updates (optional)">
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

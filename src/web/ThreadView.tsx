import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { Composer } from "./Composer";
import { avatarHue, fileSize, formatPerson, initials, longDate, personLabel, quote, replySubject, shortDate } from "./format";
import { Icon } from "./icons";
import { isOwnPlainHtml, prepareHtml, type PreparedHtml } from "./mailBody";
import { splitQuotedText, unquote } from "../shared/quote";
import type { Body, Draft, MailboxInfo, Message, Person, Thread } from "./types";

const REMOTE = /(<img[^>]+src\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:|<link[^>]+href\s*=\s*["']?\s*https?:)/i;

function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { text: get("--text", "#1d1d1f"), muted: get("--muted", "#6b7078"), accent: get("--accent", "#2f6fde"), border: get("--border", "#e2e4e8") };
}

function frameDocument(prepared: PreparedHtml, allowRemote: boolean, showQuotes: boolean) {
  const images = allowRemote ? "data: https: http:" : "data:";
  const styles = allowRemote ? "'unsafe-inline' https: http:" : "'unsafe-inline'";
  const csp = `default-src 'none'; img-src ${images}; style-src ${styles}; font-src data:${allowRemote ? " https:" : ""}; media-src data:`;
  const theme = themeColors();
  const base = prepared.designed
    ? `:root{color-scheme:light}html,body{margin:0;padding:0;background:#fff;color:#1d1d1f}body{padding:16px}`
    : `:root{color-scheme:light dark}html,body{margin:0;padding:0;background:transparent;color:${theme.text}}body{padding:2px 0}a{color:${theme.accent}}blockquote{margin:0 0 0 .5em;padding-left:.8em;border-left:2px solid ${theme.border};color:${theme.muted}}`;
  const quotes = showQuotes ? "" : "[data-nb-quote]{display:none!important}";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>
body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere}
img{max-width:100%;height:auto}pre{white-space:pre-wrap}.gmail_attr{background:none!important;color:inherit!important;margin-bottom:4px}
${base}${quotes}
</style>${prepared.head}</head><body>${prepared.body}</body></html>`;
}

function HtmlFrame({ prepared, allowRemote, showQuotes }: { prepared: PreparedHtml; allowRemote: boolean; showQuotes: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(60);
  const doc = useMemo(() => frameDocument(prepared, allowRemote, showQuotes), [prepared, allowRemote, showQuotes]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | undefined;
    const measure = () => {
      const body = frame.contentDocument?.body;
      if (body) setHeight(Math.max(Math.ceil(body.getBoundingClientRect().height), 24));
    };
    const onLoad = () => {
      measure();
      const root = frame.contentDocument?.body;
      if (root) {
        observer = new ResizeObserver(measure);
        observer.observe(root);
      }
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [doc]);

  const frame = (
    <iframe
      ref={ref}
      className={`html-frame ${prepared.designed ? "designed" : "simple"}`}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      style={{ height }}
      title="Message"
    />
  );
  return prepared.designed ? <div className="designed-frame">{frame}</div> : frame;
}

function QuoteToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button className="quote-toggle" onClick={onToggle} title={open ? "Hide quoted text" : "Show quoted text"} aria-expanded={open}>
      •••
    </button>
  );
}

function MessageContent({ body, allowRemote }: { body: Body; allowRemote: boolean }) {
  const [showQuotes, setShowQuotes] = useState(false);
  const prepared = useMemo(() => (body.html && !isOwnPlainHtml(body.html) ? prepareHtml(body.html) : null), [body.html]);
  if (prepared) {
    return (
      <>
        <HtmlFrame prepared={prepared} allowRemote={allowRemote} showQuotes={showQuotes} />
        {prepared.hasQuote && <QuoteToggle open={showQuotes} onToggle={() => setShowQuotes((v) => !v)} />}
      </>
    );
  }
  const split = splitQuotedText(body.text);
  return (
    <>
      <div className="plain">{split.main}</div>
      {split.quoted && (
        <>
          <QuoteToggle open={showQuotes} onToggle={() => setShowQuotes((v) => !v)} />
          {showQuotes && (
            <div className="plain quoted">
              {split.attribution && <div className="attribution">{split.attribution}</div>}
              <blockquote>{unquote(split.quoted)}</blockquote>
            </div>
          )}
        </>
      )}
    </>
  );
}

function Avatar({ person, me }: { person: Person; me: MailboxInfo }) {
  if (person.address === me.address) {
    return <span className="avatar self">{me.displayName ? initials({ name: me.displayName, address: me.address }) : "me"}</span>;
  }
  return (
    <span className="avatar" style={{ background: `hsl(${avatarHue(person.address)} 45% 45%)` }}>
      {initials(person)}
    </span>
  );
}

function recipients(message: Message, me: string) {
  const list = [...message.to, ...message.cc].map((p) => personLabel(p, me));
  return list.length ? `to ${list.join(", ")}` : "";
}

function MessageItem(props: {
  message: Message;
  mailbox: string;
  me: MailboxInfo;
  expanded: boolean;
  onToggle: () => void;
  onBody: (body: Body) => void;
}) {
  const { message, mailbox } = props;
  const [body, setBody] = useState<Body | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState(false);
  const [details, setDetails] = useState(false);

  useEffect(() => {
    if (!props.expanded || body) return;
    api
      .body(mailbox, message.id)
      .then((b) => {
        setBody(b);
        props.onBody(b);
      })
      .catch((e: Error) => setError(e.message));
  }, [props.expanded, body, mailbox, message.id]);

  const hasRemote = body?.html ? REMOTE.test(body.html) : false;
  const files = body?.attachments.filter((a) => !a.inline) ?? [];

  if (!props.expanded) {
    return (
      <article className="message collapsed" onClick={props.onToggle}>
        <Avatar person={message.from} me={props.me} />
        <span className="from">{personLabel(message.from, mailbox)}</span>
        <span className="snippet">{message.snippet}</span>
        <time>{shortDate(message.date)}</time>
      </article>
    );
  }

  return (
    <article className="message">
      <header className="message-header" onClick={props.onToggle}>
        <Avatar person={message.from} me={props.me} />
        <div className="who">
          <div>
            <strong>{message.from.address === mailbox ? props.me.displayName || "me" : message.from.name || message.from.address}</strong>
            {message.from.address !== mailbox && message.from.name && <span className="muted"> &lt;{message.from.address}&gt;</span>}
          </div>
          <button
            className="link muted small"
            onClick={(e) => {
              e.stopPropagation();
              setDetails((d) => !d);
            }}
          >
            {recipients(message, mailbox)} ▾
          </button>
        </div>
        <time title={longDate(message.date)}>{longDate(message.date)}</time>
      </header>
      {details && (
        <dl className="details">
          <dt>From</dt>
          <dd>{formatPerson(message.from)}</dd>
          {message.to.length > 0 && (
            <>
              <dt>To</dt>
              <dd>{message.to.map(formatPerson).join(", ")}</dd>
            </>
          )}
          {message.cc.length > 0 && (
            <>
              <dt>Cc</dt>
              <dd>{message.cc.map(formatPerson).join(", ")}</dd>
            </>
          )}
          {body?.date && (
            <>
              <dt>Date</dt>
              <dd>{body.date}</dd>
            </>
          )}
          <dt>Original</dt>
          <dd>
            <a href={api.rawUrl(mailbox, message.id)}>Download .eml</a>
          </dd>
        </dl>
      )}
      <div className="message-body">
        {error && <div className="banner error">{error}</div>}
        {!body && !error && <div className="muted">Loading…</div>}
        {body && hasRemote && !remote && (
          <div className="banner">
            Remote images are blocked. <button className="link" onClick={() => setRemote(true)}>Show images</button>
          </div>
        )}
        {body && <MessageContent body={body} allowRemote={remote} />}
        {files.length > 0 && (
          <ul className="attachments">
            {files.map((file) => (
              <li key={file.index}>
                <a href={api.attachmentUrl(mailbox, message.id, file.index)} download={file.filename}>
                  <Icon name="download" size={16} />
                  <span className="ellipsis">{file.filename}</span>
                  <span className="muted small">{fileSize(file.size)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

export function ThreadView(props: {
  mailbox: MailboxInfo;
  threadId: string;
  brevo: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const me = props.mailbox.address;
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [bodies, setBodies] = useState<Record<string, Body>>({});
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = async (markRead: boolean) => {
    try {
      const result = await api.thread(me, props.threadId);
      setThread(result.thread);
      setMessages(result.messages);
      setExpanded((prev) => {
        const next = new Set(prev);
        result.messages.forEach((m) => !m.read && next.add(m.id));
        const last = result.messages[result.messages.length - 1];
        if (last) next.add(last.id);
        return next;
      });
      if (markRead && result.thread.unread > 0) {
        await api.setRead(me, props.threadId, true);
        props.onChanged();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load(true);
  }, [props.threadId, me]);

  const startReply = async (mode: "reply" | "all" | "forward") => {
    const target = messages[messages.length - 1];
    if (!target) return;
    const body = bodies[target.id] ?? (await api.body(me, target.id));
    const text = body.text || "";
    if (mode === "forward") {
      const header = `\n\n---------- Forwarded message ---------\nFrom: ${formatPerson(target.from)}\nDate: ${longDate(target.date)}\nSubject: ${target.subject}\nTo: ${target.to.map(formatPerson).join(", ")}\n\n`;
      setDraft({ to: "", cc: "", bcc: "", subject: `Fwd: ${target.subject}`, text: header + text });
      return;
    }
    const lastIncoming = [...messages].reverse().find((m) => m.direction === "in");
    const base = target.direction === "out" ? target : (lastIncoming ?? target);
    const baseBody = bodies[base.id];
    const primary: Person[] = base.direction === "out" ? base.to : baseBody?.replyTo.length ? baseBody.replyTo : [base.from];
    const others = mode === "all" ? [...base.to, ...base.cc].filter((p) => p.address !== me && !primary.some((x) => x.address === p.address)) : [];
    setDraft({
      to: primary.map(formatPerson).join(", "),
      cc: others.map(formatPerson).join(", "),
      bcc: "",
      subject: replySubject(thread?.subject ?? target.subject),
      text: quote(text, target.from, target.date),
      replyTo: target.id,
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select") || event.metaKey || event.ctrlKey || event.altKey || draft) return;
      if (event.key === "r") {
        event.preventDefault();
        startReply("reply");
      }
      if (event.key === "a") {
        event.preventDefault();
        startReply("all");
      }
      if (event.key === "f") {
        event.preventDefault();
        startReply("forward");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error) return <div className="banner error">{error}</div>;
  if (!thread) return <div className="empty muted">Loading…</div>;

  return (
    <div className="thread-view">
      <header className="thread-toolbar">
        <button className="icon-button back" onClick={props.onClose} title="Back">
          <Icon name="back" />
        </button>
        <h1 className="thread-subject">{thread.subject || "(no subject)"}</h1>
        <button
          className="icon-button"
          title="Mark unread"
          onClick={async () => {
            await api.setRead(me, props.threadId, false);
            props.onChanged();
            props.onClose();
          }}
        >
          <Icon name="unread" />
        </button>
        <button
          className="icon-button"
          title="Delete conversation"
          onClick={async () => {
            if (!confirm("Delete this conversation for good?")) return;
            await api.deleteThread(me, props.threadId);
            props.onDeleted();
          }}
        >
          <Icon name="trash" />
        </button>
      </header>
      <div className="messages">
        {messages.map((m) => (
          <MessageItem
            key={m.id}
            message={m}
            mailbox={me}
            me={props.mailbox}
            expanded={expanded.has(m.id)}
            onToggle={() =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(m.id)) next.delete(m.id);
                else next.add(m.id);
                return next;
              })
            }
            onBody={(b) => setBodies((prev) => ({ ...prev, [m.id]: b }))}
          />
        ))}
      </div>
      {draft ? (
        <Composer
          inline
          mailbox={props.mailbox}
          initial={draft}
          brevo={props.brevo}
          onClose={() => setDraft(null)}
          onSent={() => {
            setDraft(null);
            load(false);
            props.onChanged();
          }}
        />
      ) : (
        <div className="reply-bar">
          <button onClick={() => startReply("reply")} title="Reply (r)">
            <Icon name="reply" /> Reply
          </button>
          <button onClick={() => startReply("all")} title="Reply all (a)">
            <Icon name="replyAll" /> Reply all
          </button>
          <button onClick={() => startReply("forward")} title="Forward (f)">
            <Icon name="forward" /> Forward
          </button>
        </div>
      )}
    </div>
  );
}

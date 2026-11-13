import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { fileSize } from "./format";
import { Icon } from "./icons";
import type { Draft, MailboxInfo } from "./types";

const MAX_ATTACHMENTS = 10 * 1024 * 1024;

interface PendingFile {
  filename: string;
  contentType: string;
  content: string;
  size: number;
}

function readFile(file: File): Promise<PendingFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve({ filename: file.name, contentType: file.type || "application/octet-stream", content: url.slice(url.indexOf(",") + 1), size: file.size });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function Composer(props: {
  mailbox: MailboxInfo;
  mailboxes?: MailboxInfo[];
  initial: Draft;
  brevo: boolean;
  inline?: boolean;
  onClose: () => void;
  onSent: (sent: { id: string; threadId: string }) => void;
}) {
  const [draft, setDraft] = useState<Draft>(props.initial);
  const [fromAddress, setFromAddress] = useState(props.mailbox.address);
  const choices = !props.initial.replyTo && props.mailboxes && props.mailboxes.length > 1 ? props.mailboxes : null;
  const sender = choices?.find((m) => m.address === fromAddress) ?? props.mailbox;
  const [showCc, setShowCc] = useState(Boolean(props.initial.cc || props.initial.bcc));
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const to = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (props.initial.to) {
      body.current?.focus();
      body.current?.setSelectionRange(0, 0);
      body.current?.scrollTo(0, 0);
    } else to.current?.focus();
  }, []);

  const set = (key: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((d) => ({ ...d, [key]: event.target.value }));

  const total = files.reduce((sum, f) => sum + f.size, 0);

  const send = async () => {
    if (sending) return;
    if (!draft.to.trim() && !draft.cc.trim() && !draft.bcc.trim()) {
      setError("Add at least one recipient");
      return;
    }
    if (!draft.subject.trim() && !confirm("Send without a subject?")) return;
    setSending(true);
    setError(null);
    try {
      const sent = await api.send(sender.address, {
        ...draft,
        attachments: files.map(({ filename, contentType, content }) => ({ filename, contentType, content })),
      });
      props.onSent(sent);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
    if (event.key === "Escape") props.onClose();
  };

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const added = await Promise.all(Array.from(list).map(readFile));
    const next = [...files, ...added];
    if (next.reduce((sum, f) => sum + f.size, 0) > MAX_ATTACHMENTS) {
      setError("Attachments are limited to 10 MB in total");
      return;
    }
    setFiles(next);
  };

  return (
    <div className={props.inline ? "composer inline" : "composer floating"} onKeyDown={onKeyDown}>
      <header className="composer-header">
        <span>{props.initial.replyTo ? "Reply" : "New message"}</span>
        <button className="icon-button" onClick={props.onClose} title="Discard">
          <Icon name="close" size={16} />
        </button>
      </header>
      {!props.brevo && <div className="banner error">Sending is not set up yet. Open Settings → Setup checklist to connect Brevo.</div>}
      <div className="field">
        <label>From</label>
        {choices ? (
          <select className="from-select" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)}>
            {choices.map((m) => (
              <option key={m.address} value={m.address}>
                {m.displayName ? `${m.displayName} <${m.address}>` : m.address}
              </option>
            ))}
          </select>
        ) : (
          <span className="muted">{props.mailbox.displayName ? `${props.mailbox.displayName} <${props.mailbox.address}>` : props.mailbox.address}</span>
        )}
      </div>
      <div className="field">
        <label htmlFor="to">To</label>
        <input id="to" ref={to} value={draft.to} onChange={set("to")} autoComplete="off" />
        {!showCc && (
          <button className="link small" onClick={() => setShowCc(true)}>
            Cc Bcc
          </button>
        )}
      </div>
      {showCc && (
        <>
          <div className="field">
            <label htmlFor="cc">Cc</label>
            <input id="cc" value={draft.cc} onChange={set("cc")} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="bcc">Bcc</label>
            <input id="bcc" value={draft.bcc} onChange={set("bcc")} autoComplete="off" />
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="subject">Subject</label>
        <input id="subject" value={draft.subject} onChange={set("subject")} />
      </div>
      <textarea ref={body} className="composer-body" value={draft.text} onChange={set("text")} />
      {files.length > 0 && (
        <ul className="attachments">
          {files.map((f, i) => (
            <li key={i}>
              <span className="chip">
                <span className="ellipsis">{f.filename}</span>
                <span className="muted small">{fileSize(f.size)}</span>
                <button className="icon-button" onClick={() => setFiles(files.filter((_, j) => j !== i))} title="Remove">
                  <Icon name="close" size={12} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <div className="banner error">{error}</div>}
      <footer className="composer-footer">
        <button className="primary" onClick={send} disabled={sending || !props.brevo} title="Send (Ctrl+Enter)">
          {sending ? "Sending…" : "Send"}
        </button>
        <label className="icon-button attach" title="Attach files">
          <Icon name="clip" />
          <input type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        </label>
        {total > 0 && <span className="muted small">{fileSize(total)}</span>}
      </footer>
    </div>
  );
}

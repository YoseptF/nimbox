import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { Composer } from "./Composer";
import { githubReady } from "./GithubConnect";
import { UpdateBanner } from "./UpdateBanner";
import { snippetOf } from "./format";
import { Settings } from "./Settings";
import { Setup } from "./Setup";
import { Sidebar } from "./Sidebar";
import { ThreadList } from "./ThreadList";
import { ThreadView } from "./ThreadView";
import type { Draft, Folder, GithubState, MailboxInfo, Status, Thread } from "./types";

function readHash(): { folder: Folder; threadId: string | null } {
  const [, folder, threadId] = location.hash.split("/");
  const valid = folder === "sent" || folder === "all" ? folder : "inbox";
  return { folder: valid, threadId: threadId || null };
}

function writeHash(folder: Folder, threadId: string | null) {
  const next = `#/${folder}${threadId ? `/${threadId}` : ""}`;
  if (location.hash !== next) history.pushState(null, "", next);
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mailboxes, setMailboxes] = useState<MailboxInfo[]>([]);
  const [mailbox, setMailbox] = useState<string>(() => localStorage.getItem("nimbox.mailbox") ?? "");
  const [route, setRoute] = useState(readHash);
  const [query, setQuery] = useState("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [github, setGithub] = useState<GithubState | null>(null);

  const { folder, threadId } = route;
  const current = useMemo(() => mailboxes.find((m) => m.address === mailbox), [mailboxes, mailbox]);

  useEffect(() => {
    const onPop = () => setRoute(readHash());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const loadMailboxes = useCallback(async () => {
    const list = await api.mailboxes();
    setMailboxes(list);
    setMailbox((selected) => (list.some((m) => m.address === selected) ? selected : (list[0]?.address ?? "")));
  }, []);

  useEffect(() => {
    api
      .status()
      .then(async (s) => {
        setStatus(s);
        if (s.authenticated) {
          await loadMailboxes();
          setGithub(await api.github().catch(() => null));
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [loadMailboxes]);

  useEffect(() => {
    if (mailbox) localStorage.setItem("nimbox.mailbox", mailbox);
  }, [mailbox]);

  const loadThreads = useCallback(
    async (append = false) => {
      if (!mailbox) return;
      setLoading(true);
      try {
        const before = append ? threads[threads.length - 1]?.lastDate : undefined;
        const page = await api.threads(mailbox, folder, { before, q: query });
        setThreads((existing) => (append ? [...existing, ...page] : page));
        setHasMore(page.length === 50);
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not load mail");
      } finally {
        setLoading(false);
      }
    },
    [mailbox, folder, query, threads],
  );

  useEffect(() => {
    loadThreads(false);
  }, [mailbox, folder, query, refreshKey]);

  const previewed = useRef(new Set<string>());
  useEffect(() => {
    const missing = threads.filter((t) => !t.snippet && !previewed.current.has(t.lastMessageId)).slice(0, 20);
    if (!mailbox || missing.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const thread of missing) {
        if (cancelled) return;
        previewed.current.add(thread.lastMessageId);
        try {
          const body = await api.body(mailbox, thread.lastMessageId);
          const snippet = snippetOf(body.text);
          const hasAttachments = thread.hasAttachments || body.attachments.some((a) => !a.inline);
          setThreads((list) => list.map((t) => (t.id === thread.id ? { ...t, snippet, hasAttachments } : t)));
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threads, mailbox]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        setRefreshKey((k) => k + 1);
        loadMailboxes().catch(() => {});
      }
    };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadMailboxes]);

  const openThread = useCallback((id: string | null) => {
    setRoute((r) => {
      writeHash(r.folder, id);
      return { ...r, threadId: id };
    });
  }, []);

  const openFolder = useCallback((next: Folder) => {
    writeHash(next, null);
    setRoute({ folder: next, threadId: null });
  }, []);

  const onThreadChanged = useCallback(() => {
    setRefreshKey((k) => k + 1);
    loadMailboxes().catch(() => {});
  }, [loadMailboxes]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]") || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "c" && current) {
        event.preventDefault();
        setDraft({ to: "", cc: "", bcc: "", subject: "", text: "" });
      }
      if (event.key === "j" || event.key === "k") {
        const index = threads.findIndex((t) => t.id === threadId);
        const next = threads[event.key === "j" ? index + 1 : Math.max(index - 1, 0)];
        if (next) openThread(next.id);
      }
      if (event.key === "Escape" && threadId) openThread(null);
      if (event.key === "/") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".search input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threads, threadId, openThread, current]);

  if (error && !status) return <div className="fatal">{error}</div>;
  if (!status) return <div className="fatal muted">Loading…</div>;
  if (!status.authenticated) return <Setup status={status} />;

  const githubPending = Boolean(github?.enabled && !github.skipped && !github.lapsed && !githubReady(github));
  if (mailboxes.length === 0 || githubPending) {
    return <Setup status={status} hasMailboxes={mailboxes.length > 0} github={github} onMailboxAdded={loadMailboxes} onGithub={setGithub} />;
  }

  return (
    <div className="shell">
      <UpdateBanner github={github} onGithub={setGithub} />
      <div className={`app ${threadId ? "reading" : ""}`}>
        <Sidebar
          mailboxes={mailboxes}
          mailbox={mailbox}
          folder={folder}
          onMailbox={(address) => {
            setMailbox(address);
            openThread(null);
          }}
          onFolder={openFolder}
          onCompose={() => setDraft({ to: "", cc: "", bcc: "", subject: "", text: "" })}
          onSettings={() => setSettingsOpen(true)}
          email={status.email}
        />
        <ThreadList
          threads={threads}
          selected={threadId}
          me={mailbox}
          folder={folder}
          loading={loading}
          hasMore={hasMore}
          error={error}
          onSelect={openThread}
          onMore={() => loadThreads(true)}
          onSearch={setQuery}
          onRefresh={onThreadChanged}
        />
        <main className="reader">
          {threadId && current ? (
            <ThreadView
              key={threadId}
              mailbox={current}
              threadId={threadId}
              brevo={status.brevo}
              onClose={() => openThread(null)}
              onChanged={onThreadChanged}
              onDeleted={() => {
                openThread(null);
                onThreadChanged();
              }}
            />
          ) : (
            <div className="empty muted">{threads.length ? "Select a conversation" : ""}</div>
          )}
        </main>
        {draft && current && (
          <Composer
            mailbox={current}
            initial={draft}
            brevo={status.brevo}
            onClose={() => setDraft(null)}
            onSent={(sent) => {
              setDraft(null);
              onThreadChanged();
              if (folder !== "inbox") openThread(sent.threadId);
            }}
          />
        )}
        {settingsOpen && (
          <Settings
            mailboxes={mailboxes}
            status={status}
            github={github}
            onGithub={setGithub}
            onClose={() => setSettingsOpen(false)}
            onSaved={loadMailboxes}
          />
        )}
      </div>
    </div>
  );
}

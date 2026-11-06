import { useEffect, useState } from "react";
import { firstName, shortDate } from "./format";
import { Icon } from "./icons";
import type { Folder, Thread } from "./types";

const TITLES: Record<Folder, string> = { inbox: "Inbox", sent: "Sent", all: "All mail" };

function senders(thread: Thread, me: string) {
  if (thread.participants.length === 1) {
    const only = thread.participants[0];
    const label = only.address === me ? "me" : only.name || only.address;
    return thread.count > 1 ? `${label} (${thread.count})` : label;
  }
  const names = thread.participants.map((p) => firstName(p, me));
  const unique = [...new Set(names)];
  const label = unique.length > 3 ? `${unique[0]} … ${unique.slice(-2).join(", ")}` : unique.join(", ");
  return thread.count > 1 ? `${label} (${thread.count})` : label;
}

export function ThreadList(props: {
  threads: Thread[];
  selected: string | null;
  me: string;
  folder: Folder;
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onMore: () => void;
  onSearch: (query: string) => void;
  onRefresh: () => void;
}) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => props.onSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <section className="list">
      <header className="list-header">
        <h1>{TITLES[props.folder]}</h1>
        <button className="icon-button" onClick={props.onRefresh} title="Refresh">
          <Icon name="refresh" />
        </button>
      </header>
      <label className="search">
        <input type="search" placeholder="Search mail" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      {props.error && <div className="banner error">{props.error}</div>}
      <ul className="threads">
        {props.threads.map((t) => (
          <li key={t.id}>
            <button className={`thread ${t.unread ? "unread" : ""} ${props.selected === t.id ? "selected" : ""}`} onClick={() => props.onSelect(t.id)}>
              <div className="thread-top">
                <span className="senders">{senders(t, props.me)}</span>
                {t.hasAttachments && <Icon name="clip" size={14} />}
                <time>{shortDate(t.lastDate)}</time>
              </div>
              <div className="subject">{t.subject || "(no subject)"}</div>
              {t.snippet && <div className="snippet">{t.snippet}</div>}
            </button>
          </li>
        ))}
      </ul>
      {!props.loading && props.threads.length === 0 && <div className="empty muted">{search ? "No matches" : "Nothing here yet"}</div>}
      {props.hasMore && (
        <button className="more" onClick={props.onMore} disabled={props.loading}>
          {props.loading ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}

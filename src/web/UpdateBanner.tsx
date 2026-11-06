import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { GithubConnect, githubReady } from "./GithubConnect";
import { Icon } from "./icons";
import type { GithubState, UpdateState } from "./types";

const SLOW_BUILD = 15 * 60 * 1000;

function Notes({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length)
      blocks.push(
        <ul key={blocks.length}>
          {list.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>,
      );
    list = [];
  };
  for (const raw of lines) {
    const line = raw
      .trim()
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1");
    if (/^[-*] /.test(line)) list.push(line.slice(2));
    else {
      flush();
      if (/^#+ /.test(line)) blocks.push(<h4 key={blocks.length}>{line.replace(/^#+ /, "")}</h4>);
      else if (line) blocks.push(<p key={blocks.length}>{line}</p>);
    }
  }
  flush();
  return <div className="release-notes">{blocks}</div>;
}

export function UpdateBanner({ github, onGithub }: { github: GithubState | null; onGithub: (github: GithubState) => void }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [hidden, setHidden] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wantsUpdate = useRef(false);

  useEffect(() => {
    api
      .updates()
      .then(setState)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!state?.pending) return;
    const target = state.pending.version;
    const id = setInterval(async () => {
      try {
        const status = await api.status();
        if (status.version === target) location.reload();
      } catch {}
    }, 10000);
    return () => clearInterval(id);
  }, [state?.pending?.version]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.applyUpdate();
      setConnecting(false);
      setState(await api.updates());
      if (result.status === "up-to-date") location.reload();
    } catch (e) {
      if (e instanceof ApiError && (e.code === "not_connected" || e.code === "no_repo")) {
        onGithub(await api.github());
        setConnecting(true);
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (wantsUpdate.current && githubReady(github)) {
      wantsUpdate.current = false;
      apply();
    }
  }, [github]);

  if (!state || (!state.available && !state.pending)) return null;

  if (state.pending) {
    const slow = Date.now() - state.pending.startedAt > SLOW_BUILD;
    return (
      <div className="update-banner">
        <div className="update-row">
          <span>
            {slow
              ? `nimbox ${state.pending.version} was sent to ${github?.repo ?? "your copy"}, but Cloudflare has not finished deploying it. In the Cloudflare dashboard, open Workers & Pages, select your Worker, and check its Deployments tab.`
              : `Installing nimbox ${state.pending.version}. Cloudflare is rebuilding it; this page reloads when it's ready.`}
          </span>
        </div>
      </div>
    );
  }

  if (hidden || !state.latest) return null;

  return (
    <div className="update-banner">
      <div className="update-row">
        <strong>nimbox {state.latest.version} is available</strong>
        <span className="muted small">You have {state.current}</span>
        <span className="spacer" />
        {github?.enabled ? (
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              if (github?.enabled && !githubReady(github)) {
                wantsUpdate.current = true;
                setConnecting(true);
              } else apply();
            }}
          >
            {busy ? "Updating…" : "Update"}
          </button>
        ) : (
          <a href={state.latest.url} target="_blank" rel="noopener">
            Release page
          </a>
        )}
        <button className="icon-button" title="Hide until next time" onClick={() => setHidden(true)}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <Notes text={state.latest.notes} />
      {error && <p className="error-text small">{error}</p>}
      {connecting && github && (
        <div className="overlay" onClick={() => setConnecting(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Connect GitHub">
            <header className="dialog-header">
              <h2>Connect GitHub to update</h2>
              <button className="icon-button" onClick={() => setConnecting(false)} title="Close">
                <Icon name="close" />
              </button>
            </header>
            <p className="small">nimbox needs to reach your copy of its code on GitHub once. After that, updates take one click.</p>
            <GithubConnect
              github={github}
              onChange={(next) => {
                wantsUpdate.current = true;
                onGithub(next);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

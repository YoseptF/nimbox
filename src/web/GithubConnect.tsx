import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { DeviceCode, GithubState } from "./types";

type Phase = { kind: "idle" } | { kind: "code"; device: DeviceCode } | { kind: "expired" } | { kind: "denied" };

export function githubReady(github: GithubState | null) {
  return Boolean(github?.connected && github.repo);
}

export function GithubConnect({ github, onChange }: { github: GithubState; onChange: (github: GithubState) => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [attention, setAttention] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const githubTab = useRef<Window | null>(null);
  const installCard = useRef<HTMLDivElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (phase.kind !== "code") return;
    let interval = phase.device.interval;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const result = await api.pollGithub();
        if (stopped) return;
        if (result.status === "connected") {
          setPhase({ kind: "idle" });
          if (result.github.connected && !result.github.repo && result.github.candidates.length === 0) openInstall(result.github.installUrl);
          onChange(result.github);
          return;
        }
        if (result.status === "expired" || result.status === "denied") {
          setPhase({ kind: result.status });
          return;
        }
        interval = result.interval ?? interval;
      } catch (e) {
        setError((e as Error).message);
      }
      timer.current = setTimeout(tick, interval * 1000);
    };
    timer.current = setTimeout(tick, interval * 1000);
    return () => {
      stopped = true;
      clearTimeout(timer.current);
    };
  }, [phase]);

  const openInstall = (url: string) => {
    let opened: Window | null = null;
    const tab = githubTab.current;
    if (tab && !tab.closed) {
      try {
        tab.location.href = url;
        tab.focus();
        opened = tab;
      } catch {}
    }
    if (!opened) opened = window.open(url, "nimbox-github");
    setAttention(true);
  };

  const waitingForInstall = github.connected && !github.repo && github.candidates.length === 0;

  useEffect(() => {
    if (!waitingForInstall) return;
    const before = document.title;
    document.title = "Last step: install on your copy · nimbox";
    installCard.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    return () => {
      document.title = before;
    };
  }, [waitingForInstall]);

  useEffect(() => {
    if (!waitingForInstall) return;
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await api.github();
        if (next.repo || next.candidates.length || !next.connected) onChange(next);
      } catch {}
    }, 4000);
    return () => clearInterval(id);
  }, [waitingForInstall]);

  const start = async () => {
    setError(null);
    try {
      setPhase({ kind: "code", device: await api.connectGithub() });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openGithub = async (device: DeviceCode) => {
    try {
      await navigator.clipboard.writeText(device.userCode);
      setCopied(true);
    } catch {}
    githubTab.current = window.open(device.verificationUri, "nimbox-github");
  };

  if (github.connected && github.repo) {
    return (
      <p className="small">
        Connected to <b>{github.repo}</b>
        {github.login ? ` as ${github.login}` : ""}.
      </p>
    );
  }

  if (github.connected && github.candidates.length > 1) {
    return (
      <div className="github-connect">
        <p>Which repository is your nimbox copy?</p>
        <div className="choices">
          {github.candidates.map((repo) => (
            <button key={repo} className="choice" onClick={async () => onChange(await api.chooseRepo(repo))}>
              {repo}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (waitingForInstall) {
    return (
      <div className="github-connect" ref={installCard}>
        <p className="step-label">Step 2 of 2: install on your copy</p>
        <p>
          You're not done yet, even if GitHub said "you're all set". GitHub asks where to install nimbox-updater: choose <b>Only select repositories</b>,
          pick your nimbox copy, and click <b>Install</b>.
        </p>
        <a
          className={`primary button-link ${attention ? "attention" : ""}`}
          href={github.installUrl}
          target="nimbox-github"
          onClick={() => setAttention(false)}
        >
          Choose your nimbox copy on GitHub
        </a>
        <p className="muted small">This page continues on its own once you're done.</p>
      </div>
    );
  }

  if (phase.kind === "code") {
    return (
      <div className="github-connect">
        <p className="step-label">Step 1 of 2: approve on GitHub</p>
        <p>
          Enter this code on GitHub, then click <b>Authorize nimbox-updater</b>. GitHub then says "you're all set": come back to this page for step 2.
        </p>
        <div className="device-code">{phase.device.userCode}</div>
        <button className="primary" onClick={() => openGithub(phase.device)}>
          {copied ? "Code copied, open GitHub" : "Copy code and open GitHub"}
        </button>
        <p className="muted small">Waiting for you to approve on GitHub…</p>
        {error && <p className="error-text small">{error}</p>}
      </div>
    );
  }

  return (
    <div className="github-connect">
      {phase.kind === "expired" && <p className="small">The code expired before it was used.</p>}
      {phase.kind === "denied" && <p className="small">GitHub says the request was cancelled.</p>}
      {github.lapsed && phase.kind === "idle" && <p className="small">The GitHub connection stopped working. Connect again to install updates.</p>}
      <p className="small">
        This takes two short pages on GitHub: first you approve nimbox-updater, then you pick your nimbox copy. After the first page GitHub says
        "you're all set", but come back here for the second.
      </p>
      <button className="primary" onClick={start}>
        {phase.kind === "idle" ? "Connect GitHub" : "Get a new code"}
      </button>
      {error && <p className="error-text small">{error}</p>}
    </div>
  );
}

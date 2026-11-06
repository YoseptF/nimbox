import pkg from "../../package.json";

export const VERSION: string = pkg.version;
export const UPSTREAM_REPO = "YoseptF/nimbox";
export const GITHUB_CLIENT_ID = "Iv23lixnboFLnB3fDSEB";
export const GITHUB_APP_SLUG = "nimbox-updater";

export function compareVersions(a: string, b: string) {
  const pa = a.replace(/^v/, "").split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

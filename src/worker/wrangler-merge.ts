type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

export function parseJsonc(text: string): Obj {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const KEEP = ["name", "account_id", "workers_dev", "route", "routes", "preview_urls", "vars"];

const BY_BINDING: Record<string, string[]> = {
  r2_buckets: ["bucket_name", "preview_bucket_name", "jurisdiction"],
  d1_databases: ["database_name", "database_id", "preview_database_id"],
  kv_namespaces: ["id", "preview_id"],
};

function isObj(value: Json | undefined): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeConfig(upstream: Obj, theirs: Obj): Obj {
  const result: Obj = { ...upstream };
  for (const key of KEEP) {
    if (!(key in theirs)) continue;
    if (key === "vars" && isObj(upstream.vars) && isObj(theirs.vars)) result.vars = { ...upstream.vars, ...theirs.vars };
    else result[key] = theirs[key];
  }
  for (const [list, fields] of Object.entries(BY_BINDING)) {
    const mine = upstream[list];
    const yours = theirs[list];
    if (!Array.isArray(mine) || !Array.isArray(yours)) continue;
    result[list] = mine.map((entry) => {
      if (!isObj(entry)) return entry;
      const match = yours.find((other) => isObj(other) && other.binding === entry.binding);
      if (!isObj(match)) return entry;
      const merged: Obj = { ...entry };
      for (const field of fields) if (field in match) merged[field] = match[field];
      return merged;
    });
  }
  if (isObj(upstream.env) && isObj(theirs.env)) {
    const envs: Obj = { ...upstream.env };
    for (const [name, value] of Object.entries(theirs.env)) {
      envs[name] = isObj(envs[name]) && isObj(value) ? mergeConfig(envs[name] as Obj, value) : value;
    }
    result.env = envs;
  }
  return result;
}

export function mergeWranglerConfig(upstreamText: string, theirText: string) {
  const merged = mergeConfig(parseJsonc(upstreamText), parseJsonc(theirText));
  return `${JSON.stringify(merged, null, 2)}\n`;
}

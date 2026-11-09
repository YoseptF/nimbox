import { cfApi, CfError, type CloudflareLink } from "./cloudflare";

const CLOUDFLARE_MX = /(^|\.)mx\.cloudflare\.net$/;
const CLOUDFLARE_SPF = /include:_spf\.mx\.cloudflare\.net/i;

interface AccessApp {
  id: string;
  name: string;
  session_duration?: string;
  destinations?: { type: string; worker_id?: string }[];
  [key: string]: unknown;
}

export async function findAccessApp(link: CloudflareLink) {
  const apps = await cfApi<AccessApp[]>(link.accessToken, `/accounts/${link.accountId}/access/apps?per_page=100`);
  return apps.find((a) => a.destinations?.some((d) => d.type === "worker" && d.worker_id === link.scriptTag)) ?? null;
}

export async function protectWorker(link: CloudflareLink) {
  const existing = await findAccessApp(link);
  if (existing) return existing;
  return cfApi<AccessApp>(link.accessToken, `/accounts/${link.accountId}/access/apps`, {
    method: "POST",
    body: JSON.stringify({
      name: `${link.scriptName} - Cloudflare Workers`,
      type: "self_hosted",
      destinations: [{ type: "worker", worker_id: link.scriptTag }],
      session_duration: "24h",
      policies: [
        {
          name: "Members of this Cloudflare account",
          decision: "allow",
          include: [{ cloudflare_account_member: { account_id: link.accountId } }],
        },
      ],
    }),
  });
}

const READ_ONLY = ["id", "aud", "created_at", "updated_at", "uid"];

export async function setSessionDuration(link: CloudflareLink, duration: string) {
  const app = await findAccessApp(link);
  if (!app) throw new CfError(404, "Sign-in protection is not set up yet");
  const full = await cfApi<AccessApp>(link.accessToken, `/accounts/${link.accountId}/access/apps/${app.id}`);
  const body: Record<string, unknown> = { ...full, session_duration: duration };
  for (const key of READ_ONLY) delete body[key];
  if (Array.isArray(body.policies)) {
    body.policies = (body.policies as { id?: string; precedence?: number }[]).map((p, i) => ({ id: p.id, precedence: p.precedence ?? i + 1 }));
  }
  return cfApi<AccessApp>(link.accessToken, `/accounts/${link.accountId}/access/apps/${app.id}`, { method: "PUT", body: JSON.stringify(body) });
}

export async function deleteAccessApp(link: CloudflareLink) {
  const app = await findAccessApp(link);
  if (app) await cfApi(link.accessToken, `/accounts/${link.accountId}/access/apps/${app.id}`, { method: "DELETE" });
}

export async function findZone(link: CloudflareLink, domain: string) {
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const name = labels.slice(i).join(".");
    const zones = await cfApi<{ id: string; name: string }[]>(
      link.accessToken,
      `/zones?name=${encodeURIComponent(name)}&account.id=${link.accountId}`,
    );
    if (zones[0]) return zones[0];
  }
  return null;
}

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  priority?: number;
}

interface Rule {
  id: string;
  enabled: boolean;
  matchers: { type: string; field?: string; value?: string }[];
  actions: { type: string; value?: string[] }[];
}

export interface Conflict {
  id: string;
  type: string;
  content: string;
  priority?: number;
}

export interface ReceivingStatus {
  domain: string;
  zone: boolean;
  enabled: boolean;
  conflicts: Conflict[];
  missing: string[];
  elsewhere: string[];
}

async function listRules(link: CloudflareLink, zoneId: string) {
  return cfApi<Rule[]>(link.accessToken, `/zones/${zoneId}/email/routing/rules?per_page=50`);
}

function ruleAddress(rule: Rule) {
  const matcher = rule.matchers.find((m) => m.type === "literal" && m.field === "to");
  return matcher?.value?.toLowerCase() ?? null;
}

function pointsHere(rule: Rule, link: CloudflareLink) {
  return rule.actions.some((a) => a.type === "worker" && a.value?.includes(link.scriptName));
}

async function conflictsFor(link: CloudflareLink, zoneId: string, domain: string): Promise<Conflict[]> {
  const records = await cfApi<DnsRecord[]>(link.accessToken, `/zones/${zoneId}/dns_records?name=${encodeURIComponent(domain)}&per_page=100`);
  const mx = records.filter((r) => r.type === "MX" && !CLOUDFLARE_MX.test(r.content.toLowerCase()));
  if (mx.length === 0) return [];
  const spf = records.filter((r) => r.type === "TXT" && /^"?v=spf1\b/i.test(r.content) && !CLOUDFLARE_SPF.test(r.content));
  return [...mx, ...spf].map((r) => ({ id: r.id, type: r.type, content: r.content.replace(/^"|"$/g, ""), priority: r.priority }));
}

export async function receivingStatus(link: CloudflareLink, domain: string, addresses: string[]): Promise<ReceivingStatus> {
  const zone = await findZone(link, domain);
  if (!zone) return { domain, zone: false, enabled: false, conflicts: [], missing: addresses, elsewhere: [] };
  const settings = await cfApi<{ enabled?: boolean; status?: string }>(link.accessToken, `/zones/${zone.id}/email/routing`).catch(
    () => ({ enabled: false }) as { enabled?: boolean },
  );
  const enabled = Boolean(settings.enabled);
  const conflicts = enabled ? [] : await conflictsFor(link, zone.id, domain);
  const rules = enabled ? await listRules(link, zone.id) : [];
  const missing: string[] = [];
  const elsewhere: string[] = [];
  for (const address of addresses) {
    const rule = rules.find((r) => ruleAddress(r) === address);
    if (!rule) missing.push(address);
    else if (!pointsHere(rule, link) || !rule.enabled) elsewhere.push(address);
  }
  return { domain, zone: true, enabled, conflicts, missing, elsewhere };
}

export async function addRule(link: CloudflareLink, zoneId: string, address: string) {
  const rules = await listRules(link, zoneId);
  const existing = rules.find((r) => ruleAddress(r) === address);
  const body = JSON.stringify({
    name: `nimbox: ${address}`,
    enabled: true,
    matchers: [{ type: "literal", field: "to", value: address }],
    actions: [{ type: "worker", value: [link.scriptName] }],
  });
  if (!existing) return cfApi(link.accessToken, `/zones/${zoneId}/email/routing/rules`, { method: "POST", body });
  if (pointsHere(existing, link) && existing.enabled) return existing;
  return cfApi(link.accessToken, `/zones/${zoneId}/email/routing/rules/${existing.id}`, { method: "PUT", body });
}

export async function removeRule(link: CloudflareLink, address: string) {
  const zone = await findZone(link, address.split("@")[1]);
  if (!zone) return;
  const rules = await listRules(link, zone.id).catch(() => []);
  for (const rule of rules) {
    if (ruleAddress(rule) === address && pointsHere(rule, link)) {
      await cfApi(link.accessToken, `/zones/${zone.id}/email/routing/rules/${rule.id}`, { method: "DELETE" });
    }
  }
}

export async function setUpReceiving(link: CloudflareLink, domain: string, addresses: string[], approvedDeletes: string[]) {
  const zone = await findZone(link, domain);
  if (!zone) throw new CfError(404, `${domain} is not in this Cloudflare account`);
  const settings = await cfApi<{ enabled?: boolean }>(link.accessToken, `/zones/${zone.id}/email/routing`).catch(() => ({ enabled: false }));
  if (!settings.enabled) {
    const conflicts = await conflictsFor(link, zone.id, domain);
    const pending = conflicts.filter((c) => !approvedDeletes.includes(c.id));
    if (pending.length) throw new CfError(409, "Some old mail records still need your OK before nimbox removes them");
    for (const c of conflicts) await cfApi(link.accessToken, `/zones/${zone.id}/dns_records/${c.id}`, { method: "DELETE" });
    await cfApi(link.accessToken, `/zones/${zone.id}/email/routing/dns`, { method: "POST", body: JSON.stringify({ name: zone.name }) });
  }
  for (const address of addresses) await addRule(link, zone.id, address);
  return receivingStatus(link, domain, addresses);
}

export interface WantedRecord {
  type: string;
  name: string;
  value: string;
}

export async function writeDnsRecords(link: CloudflareLink, domain: string, wanted: WantedRecord[]) {
  const zone = await findZone(link, domain);
  if (!zone) throw new CfError(404, `${domain} is not in this Cloudflare account`);
  const written: WantedRecord[] = [];
  for (const record of wanted) {
    const fqdn = record.name === "@" ? domain : `${record.name}.${domain}`;
    const existing = await cfApi<DnsRecord[]>(
      link.accessToken,
      `/zones/${zone.id}/dns_records?type=${record.type}&name=${encodeURIComponent(fqdn)}&per_page=100`,
    );
    const same = existing.some((r) => r.content.replace(/^"|"$/g, "").replace(/" "/g, "") === record.value);
    if (same) continue;
    if (record.name === "_dmarc" && existing.some((r) => /v=DMARC1/i.test(r.content))) continue;
    await cfApi(link.accessToken, `/zones/${zone.id}/dns_records`, {
      method: "POST",
      body: JSON.stringify({ type: record.type, name: fqdn, content: record.value, ttl: 1, comment: "Added by nimbox for Brevo" }),
    });
    written.push(record);
  }
  return written;
}

export async function bucketName(link: CloudflareLink) {
  const settings = await cfApi<{ bindings?: { type: string; name: string; bucket_name?: string }[] }>(
    link.accessToken,
    `/accounts/${link.accountId}/workers/scripts/${link.scriptName}/settings`,
  );
  return settings.bindings?.find((b) => b.type === "r2_bucket" && b.name === "MAIL")?.bucket_name ?? null;
}

export async function deleteBucket(link: CloudflareLink, name: string) {
  await cfApi(link.accessToken, `/accounts/${link.accountId}/r2/buckets/${encodeURIComponent(name)}`, { method: "DELETE" });
}


export async function ensureDestination(link: CloudflareLink, email: string): Promise<"verified" | "sent"> {
  const target = email.toLowerCase();
  const existing = await cfApi<{ email: string; verified?: string | null }[]>(
    link.accessToken,
    `/accounts/${link.accountId}/email/routing/addresses?per_page=50`,
  );
  const found = existing.find((a) => a.email.toLowerCase() === target);
  if (found) return found.verified ? "verified" : "sent";
  await cfApi(link.accessToken, `/accounts/${link.accountId}/email/routing/addresses`, { method: "POST", body: JSON.stringify({ email: target }) });
  return "sent";
}

export async function deleteWorker(link: CloudflareLink) {
  await cfApi(link.accessToken, `/accounts/${link.accountId}/workers/scripts/${link.scriptName}?force=true`, { method: "DELETE" });
}

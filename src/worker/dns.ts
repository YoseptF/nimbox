export interface DnsAnswer {
  type: number;
  data: string;
}

export async function dnsLookup(name: string, type: "MX" | "TXT"): Promise<DnsAnswer[]> {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: "application/dns-json" },
  });
  if (!response.ok) throw new Error(`DNS lookup failed (${response.status})`);
  const data = (await response.json()) as { Answer?: DnsAnswer[] };
  return data.Answer ?? [];
}

export function mxHost(data: string) {
  return (data.trim().split(/\s+/).pop() ?? "").replace(/\.$/, "").toLowerCase();
}

export function txtValue(data: string) {
  const parts = data.match(/"((?:[^"\\]|\\.)*)"/g);
  return parts ? parts.map((p) => p.slice(1, -1).replace(/\\(.)/g, "$1")).join("") : data.trim();
}

const CLOUDFLARE_MX = /(^|\.)mx\.cloudflare\.net$/;
const CLOUDFLARE_SPF = /include:_spf\.mx\.cloudflare\.net/i;

export interface MailRecordCheck {
  domain: string;
  checked: boolean;
  remove: { type: "MX" | "TXT"; name: string; content: string; priority?: number }[];
}

export async function oldMailRecords(domain: string): Promise<MailRecordCheck> {
  try {
    const [mx, txt] = await Promise.all([dnsLookup(domain, "MX"), dnsLookup(domain, "TXT")]);
    const remove: MailRecordCheck["remove"] = [];
    for (const answer of mx) {
      if (answer.type !== 15) continue;
      const host = mxHost(answer.data);
      if (!host || CLOUDFLARE_MX.test(host)) continue;
      const priority = Number.parseInt(answer.data.trim().split(/\s+/)[0], 10);
      remove.push({ type: "MX", name: "@", content: host, priority: Number.isFinite(priority) ? priority : undefined });
    }
    if (remove.length > 0) {
      for (const answer of txt) {
        if (answer.type !== 16) continue;
        const value = txtValue(answer.data);
        if (/^v=spf1\b/i.test(value) && !CLOUDFLARE_SPF.test(value)) remove.push({ type: "TXT", name: "@", content: value });
      }
    }
    return { domain, checked: true, remove };
  } catch {
    return { domain, checked: false, remove: [] };
  }
}

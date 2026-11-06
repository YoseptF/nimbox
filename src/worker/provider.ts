export type MailProvider = "gmail" | "outlook" | "office365" | "yahoo" | "icloud" | "proton";

const BY_DOMAIN: Record<string, MailProvider> = {
  "gmail.com": "gmail",
  "googlemail.com": "gmail",
  "outlook.com": "outlook",
  "hotmail.com": "outlook",
  "live.com": "outlook",
  "msn.com": "outlook",
  "yahoo.com": "yahoo",
  "ymail.com": "yahoo",
  "icloud.com": "icloud",
  "me.com": "icloud",
  "mac.com": "icloud",
  "proton.me": "proton",
  "protonmail.com": "proton",
  "pm.me": "proton",
};

const BY_MX: [RegExp, MailProvider][] = [
  [/(^|\.)(google|googlemail)\.com$/, "gmail"],
  [/\.mail\.protection\.outlook\.com$/, "office365"],
  [/(^|\.)yahoodns\.net$/, "yahoo"],
  [/(^|\.)icloud\.com$/, "icloud"],
  [/(^|\.)(protonmail\.ch|proton\.me)$/, "proton"],
];

export async function detectProvider(email: string): Promise<MailProvider | null> {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return null;
  const regional = domain.match(/^(hotmail|outlook|live|yahoo)\.(com?\.)?[a-z]{2,3}$/);
  const known = BY_DOMAIN[domain] ?? (regional ? BY_DOMAIN[`${regional[1]}.com`] : undefined);
  if (known) return known;
  try {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { accept: "application/dns-json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { Answer?: { type: number; data: string }[] };
    for (const answer of data.Answer ?? []) {
      if (answer.type !== 15) continue;
      const host = answer.data.split(/\s+/).pop()?.replace(/\.$/, "").toLowerCase() ?? "";
      const match = BY_MX.find(([pattern]) => pattern.test(host));
      if (match) return match[1];
    }
  } catch {}
  return null;
}

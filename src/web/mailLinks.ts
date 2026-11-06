export type MailProvider = "gmail" | "outlook" | "office365" | "yahoo" | "icloud" | "proton";

const PROVIDERS: Record<MailProvider, { label: string; android?: string; web: (to: string, from: string) => string }> = {
  gmail: {
    label: "Open Gmail",
    android: "com.google.android.gm",
    web: (to, from) =>
      `https://mail.google.com/mail/?authuser=${encodeURIComponent(to)}#search/${encodeURIComponent(`from:${from} subject:"nimbox test"`)}`,
  },
  outlook: { label: "Open Outlook", android: "com.microsoft.office.outlook", web: () => "https://outlook.live.com/mail/0/" },
  office365: { label: "Open Outlook", android: "com.microsoft.office.outlook", web: () => "https://outlook.office.com/mail/" },
  yahoo: { label: "Open Yahoo Mail", android: "com.yahoo.mobile.client.android.mail", web: () => "https://mail.yahoo.com/" },
  icloud: { label: "Open iCloud Mail", web: () => "https://www.icloud.com/mail/" },
  proton: { label: "Open Proton Mail", android: "ch.protonmail.android", web: () => "https://mail.proton.me/" },
};

export function mailLink(provider: MailProvider | null | undefined, to: string, from: string) {
  const entry = provider ? PROVIDERS[provider] : undefined;
  if (!entry) return null;
  const web = entry.web(to, from);
  if (entry.android && /Android/i.test(navigator.userAgent)) {
    return {
      label: entry.label,
      href: `intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${entry.android};S.browser_fallback_url=${encodeURIComponent(web)};end`,
    };
  }
  return { label: entry.label, href: web };
}

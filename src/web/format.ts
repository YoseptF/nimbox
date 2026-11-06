import type { Person } from "./types";

export function shortDate(ms: number) {
  const date = new Date(ms);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString([], { month: "short", day: "numeric" });
  return date.toLocaleDateString([], { year: "2-digit", month: "numeric", day: "numeric" });
}

export function longDate(ms: number) {
  return new Date(ms).toLocaleString([], { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function personLabel(person: Person, me: string) {
  if (person.address === me) return "me";
  return person.name || person.address;
}

export function firstName(person: Person, me: string) {
  if (person.address === me) return "me";
  return (person.name || person.address.split("@")[0]).split(/\s+/)[0];
}

export function formatPerson(person: Person) {
  return person.name ? `${person.name} <${person.address}>` : person.address;
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(person: Person) {
  const source = person.name || person.address;
  const parts = source.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function avatarHue(address: string) {
  let hash = 0;
  for (const char of address) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function replySubject(subject: string) {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

export function quote(text: string, from: Person, date: number) {
  const lines = text.replace(/\r\n/g, "\n").trimEnd().split("\n").map((line) => (line.startsWith(">") ? `>${line}` : `> ${line}`));
  return `\n\nOn ${longDate(date)}, ${formatPerson(from)} wrote:\n${lines.join("\n")}`;
}

export function snippetOf(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith(">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

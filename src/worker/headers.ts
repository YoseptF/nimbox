import { addressParser, decodeWords } from "postal-mime";
import type { Address } from "postal-mime";
import type { Person } from "./types";

export function decodeHeader(value: string | null | undefined) {
  if (!value) return "";
  try {
    return decodeWords(value).replace(/\s+/g, " ").trim();
  } catch {
    return value.trim();
  }
}

function flatten(list: Address[]): Person[] {
  const out: Person[] = [];
  for (const item of list) {
    if (item.group) out.push(...flatten(item.group));
    else if (item.address) out.push({ name: decodeHeader(item.name), address: item.address.toLowerCase() });
  }
  return out;
}

export function parseAddresses(value: string | null | undefined): Person[] {
  if (!value) return [];
  try {
    return flatten(addressParser(value));
  } catch {
    return [];
  }
}

export function parseMessageIds(value: string | null | undefined): string[] {
  if (!value) return [];
  const found = value.match(/<[^<>\s]+>/g);
  if (found) return found;
  const bare = value.trim();
  return bare && !/\s/.test(bare) ? [`<${bare}>`] : [];
}

export function looksLikeAttachment(contentType: string | null) {
  return /multipart\/(mixed|related)/i.test(contentType ?? "");
}

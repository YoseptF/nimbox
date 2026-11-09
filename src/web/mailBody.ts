export interface PreparedHtml {
  head: string;
  body: string;
  designed: boolean;
  hasQuote: boolean;
}

const OWN_HTML = /^\s*<div style="white-space:pre-wrap">[\s\S]*<\/div>\s*$/;

export function isOwnPlainHtml(html: string) {
  return OWN_HTML.test(html) && !/<div[\s>][\s\S]*<div[\s>]/.test(html);
}

function parseColor(value: string): [number, number, number, number] | null {
  const v = value.trim().toLowerCase();
  if (v === "transparent") return [0, 0, 0, 0];
  if (v === "black" || v === "windowtext") return [0, 0, 0, 1];
  if (v === "white" || v === "window") return [255, 255, 255, 1];
  let m = v.match(/^#([0-9a-f]{3})$/);
  if (m) return [...m[1].split("").map((c) => parseInt(c + c, 16)), 1] as [number, number, number, number];
  m = v.match(/^#([0-9a-f]{6})/);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
  m = v.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  return null;
}

function luminance([r, g, b]: [number, number, number, number]) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function isNeutralBackground(value: string) {
  if (/url\(/i.test(value)) return false;
  const color = parseColor(value.replace(/^.*?(#[0-9a-f]{3,6}|rgba?\([^)]*\)|\b[a-z]+\b).*$/i, "$1"));
  if (!color) return /^(none|inherit|initial|transparent)$/i.test(value.trim());
  return color[3] === 0 || luminance(color) > 0.92;
}

function isDarkText(value: string) {
  const color = parseColor(value);
  return Boolean(color && color[3] > 0 && luminance(color) < 0.3);
}

function looksDesigned(doc: Document) {
  if (doc.querySelectorAll("table").length >= 2) return true;
  if (doc.querySelectorAll("img").length >= 3) return true;
  for (const el of Array.from(doc.querySelectorAll("[bgcolor], [background]"))) {
    if (el.hasAttribute("background") || !isNeutralBackground(el.getAttribute("bgcolor") ?? "")) return true;
  }
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[style]"))) {
    const bg = el.style.backgroundColor || el.style.background;
    if (bg && !isNeutralBackground(bg)) return true;
  }
  for (const style of Array.from(doc.querySelectorAll("style"))) {
    const css = style.textContent ?? "";
    for (const m of css.matchAll(/background(?:-color)?\s*:\s*([^;}]+)/gi)) {
      if (!isNeutralBackground(m[1])) return true;
    }
  }
  return false;
}

function neutralize(doc: Document) {
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[style]"))) {
    if (el.style.color && isDarkText(el.style.color)) el.style.removeProperty("color");
    for (const prop of ["background-color", "background"]) {
      const value = el.style.getPropertyValue(prop);
      if (value && isNeutralBackground(value)) el.style.removeProperty(prop);
    }
  }
  for (const el of Array.from(doc.querySelectorAll("[bgcolor]"))) {
    if (isNeutralBackground(el.getAttribute("bgcolor") ?? "")) el.removeAttribute("bgcolor");
  }
  for (const el of Array.from(doc.querySelectorAll("font[color]"))) {
    if (isDarkText(el.getAttribute("color") ?? "")) el.removeAttribute("color");
  }
}

const QUOTE_SELECTORS = [
  ".gmail_quote_container",
  ".gmail_quote",
  "#divRplyFwdMsg",
  "#appendonsend",
  ".yahoo_quoted",
  ".protonmail_quote",
  ".moz-cite-prefix",
  "blockquote[type='cite']",
];

function markQuotes(doc: Document) {
  const found = doc.querySelector(QUOTE_SELECTORS.join(","));
  if (!found) return false;
  let start: Element = found;
  const previous = start.previousElementSibling;
  if (previous && (previous.tagName === "HR" || /(wrote|escribió|a écrit|schrieb):\s*$/i.test(previous.textContent ?? ""))) start = previous;
  for (let el: Element | null = start; el; el = el.nextElementSibling) el.setAttribute("data-nb-quote", "");
  for (let el = start.previousElementSibling; el && el.tagName === "BR"; el = el.previousElementSibling) el.setAttribute("data-nb-quote", "");
  for (let parent = start.parentElement; parent && parent !== doc.body; parent = parent.parentElement) {
    for (let el = parent.nextElementSibling; el; el = el.nextElementSibling) el.setAttribute("data-nb-quote", "");
  }
  return true;
}

export function prepareHtml(html: string): PreparedHtml {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of Array.from(doc.querySelectorAll("script, iframe, object, embed, form"))) el.remove();
  const designed = looksDesigned(doc);
  if (!designed) neutralize(doc);
  const hasQuote = markQuotes(doc);
  const head = Array.from(doc.querySelectorAll("style"))
    .map((s) => s.outerHTML)
    .join("");
  for (const s of Array.from(doc.body.querySelectorAll("style"))) s.remove();
  return { head, body: doc.body.innerHTML, designed, hasQuote };
}

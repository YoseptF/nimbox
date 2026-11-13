const ATTRIBUTION = /(wrote|escribió|a écrit|schrieb|scrisse|escreveu):\s*$/i;
const ORIGINAL = /^-{2,}\s*(Original Message|Mensaje original|Message d'origine|Ursprüngliche Nachricht)\s*-{2,}\s*$/i;

export interface SplitText {
  main: string;
  attribution: string;
  quoted: string;
}

export function splitQuotedText(text: string): SplitText {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trimStart().startsWith(">") || ORIGINAL.test(line.trim()));
  if (start === -1) return { main: text, attribution: "", quoted: "" };
  let attributionStart = start;
  let back = start - 1;
  while (back >= 0 && lines[back].trim() === "") back--;
  if (back >= 0 && ATTRIBUTION.test(lines[back])) {
    attributionStart = back;
    const wrapped = /^\s*\S+:\s*$/.test(lines[back]) && back > 0 && lines[back - 1].trim() !== "";
    if (wrapped) attributionStart = back - 1;
  }
  const attribution = lines.slice(attributionStart, start).join("\n").trim();
  const main = lines.slice(0, attributionStart).join("\n").replace(/\s+$/, "");
  const quoted = lines.slice(start).join("\n");
  return { main, attribution, quoted };
}

export function unquote(quoted: string) {
  return quoted
    .split("\n")
    .map((line) => line.replace(/^\s*> ?/, ""))
    .join("\n");
}

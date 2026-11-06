export function newId(now = Date.now()) {
  const time = now.toString(36).padStart(9, "0");
  const random = crypto.getRandomValues(new Uint8Array(8));
  const tail = Array.from(random, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
  return `${time}${tail}`;
}

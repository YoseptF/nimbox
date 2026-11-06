export interface ZipFile {
  path: string;
  mode: "100644" | "100755";
  data: Uint8Array;
}

async function inflate(data: Uint8Array) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(buffer: ArrayBuffer, stripTopDir = true): Promise<ZipFile[]> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("Not a zip file");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files: ZipFile[] = [];

  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Broken zip directory");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const external = view.getUint32(offset + 38, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    const unixMode = external >>> 16;
    const isSymlink = (unixMode & 0o170000) === 0o120000;
    if (name.endsWith("/") || isSymlink) continue;

    const localNameLength = view.getUint16(local + 26, true);
    const localExtraLength = view.getUint16(local + 28, true);
    const start = local + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(start, start + compressedSize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflate(raw);
    else throw new Error(`Unsupported zip compression ${method}`);

    const path = stripTopDir ? name.slice(name.indexOf("/") + 1) : name;
    if (!path) continue;
    files.push({ path, mode: unixMode & 0o111 ? "100755" : "100644", data });
  }
  return files;
}

export async function gitBlobSha(data: Uint8Array) {
  const header = new TextEncoder().encode(`blob ${data.length}\0`);
  const full = new Uint8Array(header.length + data.length);
  full.set(header);
  full.set(data, header.length);
  const digest = await crypto.subtle.digest("SHA-1", full);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

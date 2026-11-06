import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = new URL("../dist/", import.meta.url).pathname;
const out = new URL("../src/worker/assets.generated.js", import.meta.url).pathname;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const assets = {};
for (const file of walk(root)) {
  const path = `/${relative(root, file).split(sep).join("/")}`;
  const ext = path.slice(path.lastIndexOf("."));
  const type = types[ext];
  if (!type) throw new Error(`No content type for ${path}`);
  assets[path] = { type, body: readFileSync(file, "utf8"), immutable: path.startsWith("/assets/") };
}
if (!assets["/index.html"]) throw new Error("dist/index.html is missing; run vite build first");
writeFileSync(out, `export default ${JSON.stringify(assets)};\n`);
console.log(`Embedded ${Object.keys(assets).length} files into ${relative(process.cwd(), out)}`);

import assets from "./assets.generated.js";

export function serveApp(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const path = new URL(request.url).pathname;
  const asset = assets[path] ?? (path.startsWith("/assets/") ? undefined : assets["/index.html"]);
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(request.method === "HEAD" ? null : asset.body, {
    headers: {
      "content-type": asset.type,
      "cache-control": asset.immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
    },
  });
}

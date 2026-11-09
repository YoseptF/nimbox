import { authorizeUrl, CfError, exchangeCode, findWorkerForHost, pkceChallenge, randomToken, revokeToken, type CloudflareLink } from "./cloudflare";
import {
  bucketName,
  deleteAccessApp,
  deleteBucket,
  deleteWorker,
  findAccessApp,
  protectWorker,
  receivingStatus,
  removeRule,
  setSessionDuration,
  setUpReceiving,
} from "./cloudflare-actions";
import { directoryStub, type AppEnv } from "./env";
import { CLOUDFLARE_CLIENT_ID, CLOUDFLARE_REDIRECT_URI } from "./release";

export const SESSION_CHOICES = ["1h", "24h", "168h", "720h"];

export function cloudflareClientId(env: AppEnv) {
  return (env.CLOUDFLARE_CLIENT_ID || CLOUDFLARE_CLIENT_ID).trim();
}

export async function cloudflareLink(env: AppEnv): Promise<CloudflareLink | null> {
  const clientId = cloudflareClientId(env);
  if (!clientId) return null;
  return directoryStub(env).cfLink(clientId);
}

export function plainCloudflareError(error: unknown) {
  if (error instanceof CfError) {
    if (error.status === 401) return "The Cloudflare connection stopped working. Connect Cloudflare again.";
    if (error.status === 403) return "Cloudflare did not allow this. Connect Cloudflare again and keep every permission turned on.";
    return `Cloudflare said: ${error.message}`;
  }
  return "Could not reach Cloudflare. Try again in a minute.";
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
}

function domainsOf(addresses: string[]) {
  return [...new Set(addresses.map((a) => a.slice(a.indexOf("@") + 1)))];
}

export async function publicCloudflareRoute(request: Request, env: AppEnv, url: URL, path: string, signedIn: boolean): Promise<Response | null> {
  const clientId = cloudflareClientId(env);
  const directory = directoryStub(env);

  if (path === "/api/cloudflare" && request.method === "GET") {
    if (!clientId) return json({ enabled: false, connected: false, lapsed: false });
    const link = await directory.cfLink(clientId);
    const base = { enabled: true, connected: Boolean(link), lapsed: !link && (await directory.cfLapsed()) };
    if (!signedIn || !link) return json(base);
    return json({ ...base, accountName: link.accountName, workerName: link.scriptName });
  }

  if (!clientId || !path.startsWith("/api/cloudflare/")) return null;

  if (path === "/api/cloudflare/connect" && request.method === "GET") {
    const verifier = randomToken(48);
    const state = `${randomToken(16)}~${url.host}`;
    await directory.cfBegin(state, verifier);
    return redirect(authorizeUrl(clientId, CLOUDFLARE_REDIRECT_URI, state, await pkceChallenge(verifier)));
  }

  if (path === "/api/cloudflare/callback" && request.method === "GET") {
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code");
    if (!state.endsWith(`~${url.host}`)) return redirect("/?cloudflare=failed");
    const verifier = await directory.cfTake(state);
    if (!verifier || !code) return redirect(`/?cloudflare=${url.searchParams.get("error") === "access_denied" ? "cancelled" : "failed"}`);
    try {
      const token = await exchangeCode(clientId, CLOUDFLARE_REDIRECT_URI, code, verifier);
      const worker = await findWorkerForHost(token.accessToken, url.hostname);
      if (!worker) {
        await revokeToken(clientId, token.accessToken);
        return redirect("/?cloudflare=wrong-account");
      }
      await directory.cfSave({ ...token, ...worker, hostname: url.hostname });
      return redirect("/?cloudflare=connected");
    } catch (error) {
      console.error("cloudflare callback", error);
      return redirect("/?cloudflare=failed");
    }
  }

  if (path === "/api/cloudflare/protect" && request.method === "POST") {
    const link = await directory.cfLink(clientId);
    if (!link) return json({ error: "Connect Cloudflare first" }, 409);
    try {
      await protectWorker(link);
      return json({ ok: true });
    } catch (error) {
      return json({ error: plainCloudflareError(error) }, 502);
    }
  }

  return null;
}

export async function privateCloudflareRoute(
  request: Request,
  env: AppEnv,
  ctx: ExecutionContext | undefined,
  path: string,
  readBody: <T>() => Promise<T>,
): Promise<Response | null> {
  if (!path.startsWith("/api/cloudflare")) return null;
  const clientId = cloudflareClientId(env);
  const directory = directoryStub(env);
  const link = clientId ? await directory.cfLink(clientId) : null;
  const method = request.method;

  if (path === "/api/cloudflare" && method === "DELETE") {
    if (link) await revokeToken(clientId, link.accessToken);
    await directory.cfForget();
    return json({ ok: true });
  }

  if (!link) return json({ error: "Connect Cloudflare first", code: "not_connected" }, 409);

  try {
    if (path === "/api/cloudflare/receiving" && method === "GET") {
      const addresses = await directory.list();
      return json(await Promise.all(domainsOf(addresses).map((d) => receivingStatus(link, d, addresses.filter((a) => a.endsWith(`@${d}`))))));
    }

    if (path === "/api/cloudflare/receiving" && method === "POST") {
      const body = await readBody<{ domain?: string; approve?: string[] }>();
      const addresses = await directory.list();
      const domain = (body.domain ?? "").toLowerCase();
      if (!domainsOf(addresses).includes(domain)) return json({ error: "Unknown domain" }, 404);
      return json(await setUpReceiving(link, domain, addresses.filter((a) => a.endsWith(`@${domain}`)), body.approve ?? []));
    }

    if (path === "/api/cloudflare/session" && method === "GET") {
      const app = await findAccessApp(link);
      return json({ protected: Boolean(app), duration: app?.session_duration ?? null, choices: SESSION_CHOICES });
    }

    if (path === "/api/cloudflare/session" && method === "PUT") {
      const body = await readBody<{ duration?: string }>();
      if (!SESSION_CHOICES.includes(body.duration ?? "")) return json({ error: "Pick one of the listed lengths" }, 400);
      const app = await setSessionDuration(link, body.duration!);
      return json({ protected: true, duration: app.session_duration ?? body.duration, choices: SESSION_CHOICES });
    }

    if (path === "/api/cloudflare/uninstall" && method === "POST") {
      const body = await readBody<{ confirm?: string }>();
      if (body.confirm !== "delete everything") return json({ error: 'Type "delete everything" to confirm' }, 400);
      const addresses = await directory.list();
      for (const address of addresses) await removeRule(link, address).catch(() => null);
      await deleteAccessApp(link);
      let cursor: string | undefined;
      do {
        const page = await env.MAIL.list({ cursor });
        if (page.objects.length) await env.MAIL.delete(page.objects.map((o) => o.key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      const bucket = await bucketName(link).catch(() => null);
      if (bucket) await deleteBucket(link, bucket);
      const finish = (async () => {
        await deleteWorker(link);
        await revokeToken(clientId, link.accessToken);
      })().catch((error) => console.error("uninstall", error));
      if (typeof ctx?.waitUntil === "function") ctx.waitUntil(finish);
      else await finish;
      return json({ ok: true, bucket });
    }
  } catch (error) {
    if (!(error instanceof CfError)) console.error("cloudflare action", error);
    return json({ error: plainCloudflareError(error) }, error instanceof CfError && error.status === 409 ? 409 : 502);
  }

  return null;
}

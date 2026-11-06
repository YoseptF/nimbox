import { handleApi } from "./api";
import { serveApp } from "./assets";
import { receiveEmail } from "./email";
import type { AppEnv } from "./env";

export { Mailbox } from "./mailbox";
export { Directory } from "./directory";
export { Updater } from "./updater";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, ctx);
    return serveApp(request);
  },
  async email(message, env) {
    await receiveEmail(message, env);
  },
} satisfies ExportedHandler<AppEnv>;

import { handleApi } from "./api";
import { receiveEmail } from "./email";
import type { AppEnv } from "./env";

export { Mailbox } from "./mailbox";
export { Directory } from "./directory";
export { Updater } from "./updater";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
  async email(message, env) {
    await receiveEmail(message, env);
  },
} satisfies ExportedHandler<AppEnv>;

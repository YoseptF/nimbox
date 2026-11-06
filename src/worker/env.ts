import type { Mailbox } from "./mailbox";
import type { Directory } from "./directory";

export interface AppEnv {
  MAIL: R2Bucket;
  ASSETS: Fetcher;
  MAILBOX: DurableObjectNamespace<Mailbox>;
  DIRECTORY: DurableObjectNamespace<Directory>;
  BREVO_API_KEY?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_ACCESS_BYPASS?: string;
}

export function mailboxStub(env: AppEnv, address: string) {
  return env.MAILBOX.get(env.MAILBOX.idFromName(address.toLowerCase()));
}

export function directoryStub(env: AppEnv) {
  return env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"));
}

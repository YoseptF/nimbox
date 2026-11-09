import type { Mailbox } from "./mailbox";
import type { Directory } from "./directory";
import type { Updater } from "./updater";

export interface AppEnv {
  MAIL: R2Bucket;
  MAILBOX: DurableObjectNamespace<Mailbox>;
  DIRECTORY: DurableObjectNamespace<Directory>;
  UPDATER: DurableObjectNamespace<Updater>;
  BREVO_API_KEY?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_ACCESS_BYPASS?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_APP_SLUG?: string;
  CLOUDFLARE_CLIENT_ID?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
}

export function mailboxStub(env: AppEnv, address: string) {
  return env.MAILBOX.get(env.MAILBOX.idFromName(address.toLowerCase()));
}

export function directoryStub(env: AppEnv) {
  return env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"));
}

export function updaterStub(env: AppEnv) {
  return env.UPDATER.get(env.UPDATER.idFromName("updater"));
}

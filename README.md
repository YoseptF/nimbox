# nimbox

Your own email inbox on your own Cloudflare account. It receives mail for your domain through Cloudflare Email Routing, sends as your domain through Brevo, and groups everything into conversations. Everything runs on free plans, and your mail never leaves accounts you own.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YoseptF/nimbox)

## What you need

- A domain whose DNS is on Cloudflare.
- A free [Brevo](https://www.brevo.com) account, used to send mail.
- About 15 minutes.

## Setup

### 1. Deploy

Click **Deploy to Cloudflare** above. Cloudflare copies this repository into your GitHub account and shows a form:

- **Git account**: the GitHub account that gets your copy.
- **Create private Git repository**: tick it, so your copy is private.
- **Project name**: pick a name. It becomes the name of your copy on GitHub, the Worker's name and part of its address. If your GitHub account already has a repository with that name, pick a different one (the account that owns the original nimbox repository, for example, can't use `nimbox`).
- **R2 bucket**: leave **Create new** with the name `nimbox-mail`. This is where your mail is stored.
- **Location hint**: leave as is.
- **BREVO_API_KEY**: paste a Brevo key if you already have one (see [Brevo keys](#brevo-keys)). Otherwise leave it empty: nimbox asks for it on its setup page.
- **Build command** and **Deploy command**: already filled in with `npm run build` and `npm run deploy`. Leave them.
- **Enable Preview builds**: turn it off. Your copy has no use for preview builds, and leaving it on only adds builds.
- **Preview command**: leave as is. It only runs for preview builds, which you just turned off.
- **Protect with Cloudflare Access**: turn it on. This is the sign-in that keeps your mail private. (If you forget, nimbox's first page can turn it on for you.) Two more settings appear:
  - **Scope**: pick **All traffic**. With the default, **Previews only**, your inbox gets no sign-in page and nimbox refuses to open it.
  - **Authentication policy**: open **Add policy** and pick **Cloudflare account**, so only members of your Cloudflare account can get in. Don't use **Email domain** with a public mail service like gmail.com: that lets in every account on it.
  - **Session duration**: leave the default.
- **Advanced settings**: leave as they are.

When it finishes, your nimbox has its own address, like `https://<project-name>.<your-account-subdomain>.workers.dev`. To find it:

- In the Cloudflare dashboard, open **Workers & Pages**, click your project, and open the **Domains** tab. Or:
- Scroll to the last lines of the build log on the Deploy page; the address is printed there.

Bookmark it: this is the link to your inbox.

### 2. Follow the setup page

Open that address and sign in. nimbox shows a short checklist:

- **Connect Cloudflare**: one button. Cloudflare shows what nimbox may change and asks which account to use; pick the one you deployed nimbox to. After that, nimbox does the Cloudflare parts of the next steps for you.
- **Your email address**: type the address you want to use.
- **Sending**: paste your Brevo key if you didn't on the Deploy form. nimbox then adds the records Brevo needs to your domain's DNS (one button), and lets you send yourself a test email. The step turns Done once Brevo confirms your domain or a test email goes out.
- **Receiving**: one button. If your domain still sends its mail somewhere else (a forwarder like ImprovMX, for example), nimbox first shows exactly which old records it will delete and asks before deleting them. It then turns on Cloudflare's Email Routing and sends your address to nimbox. From then on, mail stops going to the old service.
- **One-click updates** (optional): connect GitHub so nimbox can update itself. See [Updating](#updating).

If the page says sign-in protection is not on, you skipped **Protect with Cloudflare Access** in step 1. The page then offers to connect Cloudflare and turn it on with one click.

Without connecting Cloudflare, every step still works: nimbox shows the records to add, links to the right dashboard pages and the exact values to pick instead.

### More addresses, forwarding and sign-in

In nimbox's **Settings**:

- **Addresses**: add or remove addresses at your domain. With Cloudflare connected, each one gets its own routing rule automatically, and mail to addresses you never added bounces back to the sender. Removing an address deletes its mail.
- **Also forward incoming mail to**: keep a copy in another inbox. With Cloudflare connected, Cloudflare emails that inbox a confirmation link; click it and forwarding starts.
- **Sign in again every**: how often nimbox asks you to sign in (1 hour to 1 month; 1 day by default).

### Brevo keys

On [Brevo's API keys page](https://app.brevo.com/settings/keys/api), click **Generate new API Key** and fill in the form:

- **Key name**: anything, for example `nimbox`.
- **Expiry**: pick the longest option.
- **Access**: **Restricted**.
- **Permissions**: set **Transactional email** to **All** (Read is not enough to send) and **Account** to **Read**, so nimbox can see when your domain is ready. Leave everything else on **None**.

Brevo turns off a key that goes 90 days without being used. If that happens, nimbox's setup page says the key was not accepted and lets you paste a new one.

## Updating

When a new version is out, nimbox shows a bar at the top of the inbox with what changed and an **Update** button. Click it: nimbox puts the new version into your copy on GitHub, Cloudflare rebuilds it, and the page reloads on the new version after a minute or two.

The first time, nimbox asks you to connect GitHub (the setup page offers this too, and you can skip it until you need it):

1. nimbox shows a short code. Click **Copy code and open GitHub**, paste the code, and click **Continue**.
2. GitHub asks you to **Authorize nimbox-updater**. Click **Authorize**. GitHub then says "you're all set", but there's one more page: go back to nimbox, which opens it for you or shows a **Choose your nimbox copy on GitHub** button.
3. GitHub asks where to install nimbox-updater. Choose **Only select repositories**, pick your nimbox copy, and click **Install**.

nimbox can only read and change the code of that one repository. The connection is stored in your own Worker, never in the browser. It stays active as long as you open nimbox at least once every 6 months; otherwise the Update button walks you through the same three steps again. You can disconnect anytime in **Settings**, or remove nimbox-updater on GitHub under **Settings → Applications**.

Updates keep your Worker name, bucket name and other values in `wrangler.jsonc`. Any other edits you made to your copy's code are replaced.

## Uninstall

In nimbox, open **Settings → Remove nimbox**, type **delete everything**, and confirm. With Cloudflare connected, nimbox deletes all your mail and its settings, then removes what it created in Cloudflare: the routing rules for your addresses, the sign-in protection, the storage bucket, and finally the app itself. Mail sent to your addresses afterwards bounces back to the sender.

Three things are left for you, because nimbox isn't allowed to remove them:

1. **Your copy on GitHub.** Open it, go to **Settings**, and click **Delete this repository** at the bottom.
2. **The update app**, if you turned on one-click updates. On [your installed GitHub Apps](https://github.com/settings/installations), click **Configure** next to **nimbox-updater** and choose **Uninstall**; then **Revoke** it on [your authorized GitHub Apps](https://github.com/settings/apps/authorizations).
3. **The Brevo key**, if you don't use it for anything else: delete it on [Brevo's API keys page](https://app.brevo.com/settings/keys/api).

Cloudflare also lists nimbox under your profile's [connected applications](https://dash.cloudflare.com/?to=/profile/access-management/authorization) until you revoke it there.

### Uninstall by hand

1. **Stop sending mail to nimbox.** Open [Email Routing](https://dash.cloudflare.com/?to=/:account/email-service/routing), click your domain, open **Routing Rules**, and delete the rules that send mail to your nimbox Worker. If you still want mail for your domain, point it somewhere else at the same time; otherwise it bounces.
2. **Delete the Worker.** Open [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages), click your project, open **Settings**, and click **Delete** at the bottom.
3. **Delete its sign-in protection.** Deleting the Worker leaves this behind. Open the [Cloudflare dashboard](https://dash.cloudflare.com/), go to **Zero Trust → Access controls → Applications**, and delete the app named after your project, like **inbox - Cloudflare Workers**.
4. **Delete your stored mail.** Open [R2](https://dash.cloudflare.com/?to=/:account/r2/overview), click the `nimbox-mail` bucket (or the name you picked), open **Settings**, click **Empty** under **Empty Bucket**, then delete the bucket.
5. Then the three GitHub and Brevo steps above.

## How it works

- One Worker serves the app itself, the API and the incoming-mail handler, all on the same address.
- Each email is kept untouched as an `.eml` file in an R2 bucket, attachments included.
- The list of conversations lives in a Durable Object per address (SQLite storage).
- Messages are threaded with the standard `Message-ID`, `In-Reply-To` and `References` headers, for both received and sent mail.
- Sending goes through Brevo's API. The key is kept in your own Worker and never sent back to the browser.
- Every API request checks that Cloudflare Access signed the visitor in, so the app stays closed even if Access is removed by mistake. Nothing needs to be copied from Access into nimbox.

## Free plan limits

- Brevo: 300 emails sent per day.
- R2: 10 GB of stored mail.
- Durable Objects: 5 GB of conversation data per account.
- Email Routing: messages up to 25 MB.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars
echo "DEV_ACCESS_BYPASS=1" >> .dev.vars
npm run dev
```

`DEV_ACCESS_BYPASS` only works on `localhost`. To send real mail locally, put your Brevo key after `BREVO_API_KEY=` in `.dev.vars`. To feed it a test email:

```sh
curl -X POST "http://localhost:8799/cdn-cgi/handler/email?from=ana@example.org&to=me@example.com" \
  --data-binary $'From: Ana <ana@example.org>\r\nTo: me@example.com\r\nSubject: Hello\r\nMessage-ID: <1@example.org>\r\n\r\nHi there\r\n'
```

Run the checks with `npm run typecheck` and `npm test`.

## Cloudflare connection (for maintainers)

"Connect Cloudflare" uses a public Cloudflare OAuth client owned by the maintainer, with PKCE and no secret. Cloudflare only allows exact redirect URLs, and every install has its own address, so Cloudflare sends people back to one fixed page, [`docs/cloudflare.html`](docs/cloudflare.html) on this repository's GitHub Pages. That page shows which nimbox the sign-in belongs to and continues there only when the person clicks. It stores nothing. The sign-in can't be finished without the secret code that only the nimbox that started it holds, and nimbox keeps the connection only if the Cloudflare account really runs that nimbox.

nimbox checks that the Cloudflare account runs it by asking Cloudflare for its own current version (the `CF_VERSION_METADATA` binding) and looking for that exact version among the account's Workers.

To register the client (Cloudflare dashboard → **Manage Account → OAuth clients → Create client**):

- **Client name**: `nimbox`
- **Response type**: `code`
- **Grant types**: `authorization_code` and `refresh_token`
- **Token authentication method**: `none`
- **Redirect URL**: `https://yoseptf.github.io/nimbox/cloudflare.html` (GitHub Pages for this repository, from `main`, folder `/docs`)
- **Scopes**, all required:

  | Dashboard choice | Scope |
  | --- | --- |
  | Workers → Admin (only Admin on this row) | `workers-scripts.admin` |
  | Workers R2 Storage → Edit | `workers-r2.write` |
  | DNS → Edit | `dns.write` |
  | Zone → Read | `zone.read` |
  | Zone Settings → Edit | `zone-settings.write` |
  | Access: Apps and Policies → Edit | `access.write` (Cloudflare adds `access.revoke` with it) |
  | Email Routing Addresses → Edit | `email-routing-address.write` |
  | Email Routing Rules → Edit | `email-routing-rule.write` |

  `src/worker/cloudflare.ts` must request exactly these. Workers → Admin is the one Workers choice that covers listing Workers and their versions, reading the Worker's settings, and deleting the Worker on uninstall.
- For use outside the maintainer's own account, the client must be public: it needs a logo, a client URL on a domain verified with the TXT record Cloudflare shows, and **Change Visibility → Public** (permanent).

The client ID goes in `CLOUDFLARE_CLIENT_ID` in `src/worker/release.ts`.

## Releasing

1. Raise `version` in `package.json`.
2. Add a `## <version>` section at the top of `CHANGELOG.md`, written for the people who use nimbox.
3. Merge to `main`. The Release workflow publishes `v<version>` with that section as its notes, and every nimbox shows the update bar within an hour.

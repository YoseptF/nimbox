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
- **Protect with Cloudflare Access**: turn it on. This is the sign-in that keeps your mail private. Two more settings appear:
  - **Scope**: pick **All traffic**. With the default, **Previews only**, your inbox gets no sign-in page and nimbox refuses to open it.
  - **Authentication policy**: open **Add policy** and pick **Cloudflare account**, so only members of your Cloudflare account can get in. Don't use **Email domain** with a public mail service like gmail.com: that lets in every account on it.
  - **Session duration**: leave the default.
- **Advanced settings**: leave as they are.

When it finishes, your nimbox has its own address, like `https://<project-name>.<your-account-subdomain>.workers.dev`. To find it:

- In the Cloudflare dashboard, open **Workers & Pages**, click your project, and open the **Domains** tab. Or:
- Scroll to the last lines of the build log on the Deploy page; the address is printed there.

Bookmark it: this is the link to your inbox.

### 2. Follow the setup page

Open that address and sign in. nimbox shows a short checklist and walks you through the rest, with links that open the right page and values you can copy:

- **Your email address**: type the address you want to use.
- **Sending**: paste your Brevo key if you didn't on the Deploy form. nimbox then lists the DNS records Brevo needs for your domain, with a **Check again** button, and lets you send yourself a test email. If your key can't read domains, nimbox links straight to [your domains in Brevo](https://app.brevo.com/senders/domain/list) instead.
- **Receiving**: one routing rule in Cloudflare's Email Routing. nimbox shows the exact address and Worker name to pick. Turning Email Routing on makes Cloudflare take over your domain's incoming mail, so it stops going to any previous forwarding service (ImprovMX, for example).
- **One-click updates** (optional): connect GitHub so nimbox can update itself. See [Updating](#updating).

If the page says sign-in protection is not on, you skipped **Protect with Cloudflare Access** in step 1; the page shows where to turn it on.

### Brevo keys

On [Brevo's API keys page](https://app.brevo.com/settings/keys/api), click **Generate new API Key** and fill in the form:

- **Key name**: anything, for example `nimbox`.
- **Expiry**: pick the longest option.
- **Access**: **Restricted**.
- **Permissions**: set **Transactional email** to **All** (Read is not enough to send). Leave everything else on **None**.

Brevo turns off a key that goes 90 days without being used. If that happens, nimbox's setup page says the key was not accepted and lets you paste a new one.

### Optional: keep a copy in another inbox

In the app, open **Settings** and fill in **Also forward incoming mail to**. That address must first be added and verified under **Email Routing → Destination addresses**.

## Updating

When a new version is out, nimbox shows a bar at the top of the inbox with what changed and an **Update** button. Click it: nimbox puts the new version into your copy on GitHub, Cloudflare rebuilds it, and the page reloads on the new version after a minute or two.

The first time, nimbox asks you to connect GitHub (the setup page offers this too, and you can skip it until you need it):

1. nimbox shows a short code. Click **Copy code and open GitHub**, paste the code, and click **Continue**.
2. GitHub asks you to **Authorize nimbox-updater**. Click **Authorize**.
3. GitHub asks where to install nimbox-updater. Choose **Only select repositories**, pick your nimbox copy, and click **Install**.

nimbox can only read and change the code of that one repository. The connection is stored in your own Worker, never in the browser. It stays active as long as you open nimbox at least once every 6 months; otherwise the Update button walks you through the same three steps again. You can disconnect anytime in **Settings**, or remove nimbox-updater on GitHub under **Settings → Applications**.

Updates keep your Worker name, bucket name and other values in `wrangler.jsonc`. Any other edits you made to your copy's code are replaced.

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

## Releasing

1. Raise `version` in `package.json`.
2. Add a `## <version>` section at the top of `CHANGELOG.md`, written for the people who use nimbox.
3. Merge to `main`. The Release workflow publishes `v<version>` with that section as its notes, and every nimbox shows the update bar within an hour.

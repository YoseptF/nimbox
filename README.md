# nimbox

Your own email inbox on your own Cloudflare account. It receives mail for your domain through Cloudflare Email Routing, sends as your domain through Brevo, and groups everything into conversations. Everything runs on free plans, and your mail never leaves accounts you own.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YoseptF/nimbox)

## What you need

- A domain whose DNS is on Cloudflare.
- A free [Brevo](https://www.brevo.com) account, used to send mail.
- About 20 minutes.

## Setup

### 1. Get Brevo ready

1. In Brevo, open **Senders, Domains & Dedicated IPs → Domains** and add your domain.
2. Brevo shows a few DNS records (DKIM, DMARC and a code to prove you own the domain). Add each one in Cloudflare under your domain's **DNS → Records**, then click **Verify** in Brevo.
3. Open **SMTP & API → API Keys** and click **Generate new API Key**. Fill in the form:
   - **Key name**: anything, for example `nimbox`.
   - **Expiry**: pick the longest option.
   - **Access**: **Restricted**.
   - **Permissions**: set **Transactional email** to **All** (Read is not enough to send). Leave everything else on **None**.

   Copy the key and keep it for the next step.

Brevo also turns off a key that goes 90 days without being used. If you send nothing for that long, sending fails until you create a new key the same way and replace `BREVO_API_KEY` in the Worker under **Settings → Variables and Secrets**.

### 2. Deploy

Click **Deploy to Cloudflare** above. Cloudflare copies this repository into your GitHub account and shows a form:

- **Git account**: the GitHub account that gets your copy.
- **Create private Git repository**: tick it, so your copy is private.
- **Project name**: pick a name. It becomes the name of your copy on GitHub, the Worker's name and part of its address. If your GitHub account already has a repository with that name, pick a different one (the account that owns the original nimbox repository, for example, can't use `nimbox`).
- **R2 bucket**: leave **Create new** with the name `nimbox-mail`. This is where your mail is stored.
- **Location hint**: leave as is.
- **BREVO_API_KEY**: paste the key from step 1.
- **Build command** and **Deploy command**: leave as they are.
- **Enable Preview builds**: turn it off. Your copy has no use for preview builds, and leaving it on only adds builds.
- **Protect with Cloudflare Access**: turn it on. It puts a Cloudflare sign-in in front of your Worker; step 3 finishes the setup.

Cloudflare then creates the Worker, the storage bucket and the database. When it finishes you get an address like `https://<project-name>.<your-account>.workers.dev`. It shows a setup page until the next step is done.

### 3. Lock it to you with Cloudflare Access

nimbox refuses to show any mail until Access is in place.

1. In the Cloudflare dashboard open **Workers & Pages**, select your Worker (the project name you picked) and open the **Access** tab.
   - If you turned on **Protect with Cloudflare Access** in step 2, the Worker is already protected. Check that its policy lets in only your own email address, and change it if not.
   - Otherwise choose **Protect this Worker behind Access** with **All traffic**, and as the policy allow only your own email address.
2. Open **Zero Trust → Access → Applications**, edit the application that protects your Worker and copy the **Application Audience (AUD) Tag**.
3. Find your team name under **Zero Trust → Settings** (it looks like `yourteam.cloudflareaccess.com`).
4. Back in the Worker, open **Settings → Variables and Secrets** and add two secrets:
   - `ACCESS_TEAM_DOMAIN` = `yourteam.cloudflareaccess.com`
   - `ACCESS_AUD` = the AUD tag

Open the app again: Cloudflare asks you to sign in, and then the setup page shows Access as done.

### 4. Send your mail to nimbox

1. In the Cloudflare dashboard open your domain, then **Email → Email Routing**, and turn it on if it is off. Cloudflare replaces your domain's MX records with its own, so mail stops going to any previous forwarding service (ImprovMX, for example) from this point on.
2. Under **Routing rules**, create a rule for an address (or edit the **Catch-all** rule) with the action **Send to a Worker** and pick your Worker.

Send yourself an email: it shows up in the inbox. Every address routed to the Worker gets its own mailbox in the app.

### 5. Turn on updates

The setup page offers to connect GitHub so nimbox can install its own updates later. It takes three clicks; see [Updating](#updating). You can skip it and do it later from **Settings** or from the update bar.

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

- One Worker serves the app, the API and the incoming-mail handler, all on the same address.
- Each email is kept untouched as an `.eml` file in an R2 bucket, attachments included.
- The list of conversations lives in a Durable Object per address (SQLite storage).
- Messages are threaded with the standard `Message-ID`, `In-Reply-To` and `References` headers, for both received and sent mail.
- Sending goes through Brevo's API. The key stays in the Worker and never reaches the browser.
- Every API request checks the Cloudflare Access sign-in token, so the app stays closed even if Access is removed by mistake.

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

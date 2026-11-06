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
3. Open **SMTP & API → API Keys** and create a key. Keep it for the next step.

### 2. Deploy

Click **Deploy to Cloudflare** above. Cloudflare copies this repository into your GitHub account, creates the Worker, the storage bucket and the database, and asks for `BREVO_API_KEY`: paste the key from step 1.

When it finishes you get an address like `https://nimbox.<your-account>.workers.dev`. It shows a setup page until the next step is done.

### 3. Lock it to you with Cloudflare Access

nimbox refuses to show any mail until Access is in place.

1. In the Cloudflare dashboard open **Workers & Pages**, select the `nimbox` Worker, open the **Access** tab and choose **Protect this Worker behind Access** with **All traffic**. As the policy, allow only your own email address.
2. Open **Zero Trust → Access → Applications**, edit the new application and copy the **Application Audience (AUD) Tag**.
3. Find your team name under **Zero Trust → Settings** (it looks like `yourteam.cloudflareaccess.com`).
4. Back in the Worker, open **Settings → Variables and Secrets** and add two secrets:
   - `ACCESS_TEAM_DOMAIN` = `yourteam.cloudflareaccess.com`
   - `ACCESS_AUD` = the AUD tag

Open the app again: Cloudflare asks you to sign in, and then the setup page shows Access as done.

### 4. Send your mail to nimbox

1. In the Cloudflare dashboard open your domain, then **Email → Email Routing**, and turn it on if it is off. Cloudflare replaces your domain's MX records with its own, so mail stops going to any previous forwarding service (ImprovMX, for example) from this point on.
2. Under **Routing rules**, create a rule for an address (or edit the **Catch-all** rule) with the action **Send to a Worker** and pick `nimbox`.

Send yourself an email: it shows up in the inbox. Every address routed to the Worker gets its own mailbox in the app.

### Optional: keep a copy in another inbox

In the app, open **Settings** and fill in **Also forward incoming mail to**. That address must first be added and verified under **Email Routing → Destination addresses**.

## Updating

Your copy lives in your GitHub account. To get new versions, open it on GitHub and click **Sync fork** (or pull from this repository). Cloudflare rebuilds and redeploys on every push.

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

`DEV_ACCESS_BYPASS` only works on `localhost`. To feed it a test email:

```sh
curl -X POST "http://localhost:8799/cdn-cgi/handler/email?from=ana@example.org&to=me@example.com" \
  --data-binary $'From: Ana <ana@example.org>\r\nTo: me@example.com\r\nSubject: Hello\r\nMessage-ID: <1@example.org>\r\n\r\nHi there\r\n'
```

Run the checks with `npm run typecheck` and `npm test`.

# Changelog

## 0.4.2

- The Receiving step now updates as soon as you add your address, instead of staying empty until you reload the page.
- If Cloudflare refuses to send a new address to nimbox, nimbox says so right away.

## 0.4.1

- **Connect Cloudflare** is turned on.
- Removing nimbox wipes all of its data first, then deletes the app itself.
- Removing an address and adding it again works.

## 0.4.0

- New **Connect Cloudflare** step: one approval on Cloudflare's own screen, and nimbox does the Cloudflare parts of setup for you.
- Receiving is one button: nimbox lists the old mail records it will delete, asks first, turns on Email Routing and sends your address to nimbox.
- Brevo's records are added to your domain with one button instead of copied by hand.
- If sign-in protection was skipped while deploying, nimbox's first page turns it on with one click.
- Settings now manages your addresses (each gets its own routing rule), confirms forwarding addresses through Cloudflare, and sets how often you sign in.
- Settings → Remove nimbox deletes your mail and everything nimbox created in Cloudflare, in one step.

## 0.3.2

- The README explains how to remove nimbox completely, including the sign-in protection that Cloudflare keeps after the Worker is deleted.
- The README explains how to change how often nimbox asks you to sign in.
- The Receiving step matches Cloudflare's new Email Routing screens (Onboard Domain, then Routing Rules) and explains the Catch-all option for several addresses.
- If your domain's mail still goes to another service, the Receiving step lists exactly which old records to delete so Cloudflare can take over.

## 0.3.1

- Sending turns Done on the setup page as soon as a test email goes out, even when nimbox can't read your domain from Brevo.
- The Brevo key instructions now add **Account** set to **Read**, so nimbox can see when your domain is ready.
- The setup page links straight to your domains in Brevo.
- The test email now goes from your nimbox address to the email you signed in with, so it works before receiving is set up.
- After a test email, a button opens your Gmail, Outlook, Yahoo, iCloud or Proton inbox (the app on Android), with Gmail searching straight for the test.

## 0.3.0

- A new setup page walks you through each step, with links that open the right page and values you can copy.
- Sign-in protection now works on its own: nothing needs to be copied from Cloudflare Access into nimbox.
- Paste your Brevo key right in nimbox. It then shows the DNS records Brevo needs for your domain and can send you a test email.
- nimbox tells you in plain words when Brevo stops accepting your key, and lets you paste a new one.

## 0.2.0

- Install new versions from inside nimbox: connect GitHub once, then click Update.
- Deleting a conversation works again.

## 0.1.0

- First version: inbox with conversations, sending through Brevo, attachments, search, and Cloudflare Access sign-in.

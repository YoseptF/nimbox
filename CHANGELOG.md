# Changelog

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

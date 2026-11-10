# Gmail → LeadFlow conversations

Receives mail from a Gmail account into LeadFlow's Conversations, for free and without a domain. A
small Google Apps Script in **your own Google account** posts the mail you label "LeadFlow" to the
inbound-email webhook (F27, D-177). It only reads mail with that label.

**Receive only for now.** Replying from LeadFlow still sends from the forwarding address, which has no
real mailbox without a domain, so answer from Gmail itself. The customer's next mail, labelled the
same way, joins the same conversation.

## Server (once)

1. In Render → Environment set `EMAIL_INBOUND_DOMAIN` to any name (for example `mail.leadflow.app`; no
   mail ever arrives there, it only gives each business its address) and `EMAIL_INBOUND_SECRET` to a
   long random string. Redeploy.
2. In LeadFlow: Settings → Channels → Email → **Create address**, and copy the address.

## Gmail (once)

1. Open [script.google.com](https://script.google.com) → **New project**, replace the code with
   [`Code.gs`](./Code.gs), and fill in `URL`, `SECRET` and `TO` at the top.
2. Run **`install`** once and allow the permissions (it reads your Gmail and sends requests). Google may
   warn that the app isn't verified: it is your own script, so choose Advanced → continue.
3. In Gmail create a filter for the mail you want in LeadFlow (for example `to:you+leads@gmail.com`,
   or mail from your website form's address) → **Apply the label** → new label `LeadFlow`.
   To label existing mail, select it and add the label by hand.

## How it behaves

- Every 5 minutes the script sends the messages under the label, then removes the label. New mail
  can take up to 5 minutes to appear.
- If LeadFlow can't be reached, the label stays and the next run tries again; a message LeadFlow
  already has is ignored.
- Mail you sent yourself, quoted text and automatic mail (vacation replies, bounces, newsletters) aren't added as customer
  messages.
- Rotate `EMAIL_INBOUND_SECRET` and update the script if it leaks. Anyone with it can add messages.

# The newsletter engine

**You own the list. The relay is a dumb pipe.**

Every ESP (MailerLite, ConvertKit, Mailchimp…) charges rent on the size of
your subscriber list — the list lives in *their* database, and leaving means
an export-and-deliverability nightmare. Fortmail flips that: subscribers are
rows in **your** KV namespace, segmentation is a key prefix, and the only
thing you pay for is emails actually sent (Resend's free tier is 3,000/month;
at real volume a transactional relay costs dimes per campaign, not
per-subscriber rent).

Built in:

- **Double opt-in** — a subscriber is never `confirmed` until they click the
  confirmation email. No bought lists, no stale imports, clean sender
  reputation from day one.
- **One-click unsubscribe (RFC 8058)** — every send carries
  `List-Unsubscribe` + `List-Unsubscribe-Post` headers and a visible
  unsubscribe link in the footer. This is both the law and the #1
  inbox-placement signal.
- **Compliance footer** — every list requires a physical mailing `address`
  (CAN-SPAM), stamped into every send automatically.
- **Suppression** — hard bounces and spam complaints (via the relay's
  webhook) suppress that address across **all** lists.
- **Chunked sending** — campaigns drain through the existing 5-minute cron in
  chunks of `NEWS_BATCH` (default 30), so a 10,000-subscriber list never
  hits Worker request limits; it just takes ticks.
- **Any number of lists** — a pen name, a brand, a product each get a `list`
  row. Fifty lists is fifty rows, not fifty ESP accounts.

There is still **no LLM inside Fortmail** — campaigns are composed by
whatever agent (or human with `curl`) you point at it.

## Setup

### 1. Pick a relay mode

The engine sends through [Resend](https://resend.com) (verify your sending
domain there first — DKIM records, a few minutes). Two ways to give Fortmail
the ability to send, in the order the worker checks them:

**Broker mode (sovereign — the key never exists on this worker).** If you run
a credential broker with an `/agent/use` door (e.g. a
[Fort Card](https://thefortthatholds.com) wallet), set three vars in
`wrangler.jsonc`:

```jsonc
"RELAY_BROKER_URL":  "https://card.your-domain.com",
"RELAY_BROKER_REPO": "you/your-config-repo",
"RELAY_CARD":        "card_xxxxxxxx"
```

The worker POSTs `{repo, card, request}` to `<RELAY_BROKER_URL>/agent/use`
and the broker injects the sealed key server-side.

**Sealed mode (simple).** Hand the worker your Resend API key once — it is
sealed (AES-GCM) into KV on arrival with the same wallet key that seals
mailbox passwords, and never stored or logged in plain:

```sh
curl -X POST -H "X-Relay-Key: re_..." "$W/news/relay?key=$KEY"
```

### 2. Create a list

```sh
curl -X POST "$W/news/list?key=$KEY" -H 'content-type: application/json' -d '{
  "slug":     "my-newsletter",
  "name":     "My Newsletter",
  "from":     "Your Name <news@your-domain.com>",
  "reply_to": "you@your-domain.com",
  "address":  "Your Business, 123 Main St, Your Town, ST 00000"
}'
```

`from` must use a domain verified in your relay. `address` is required — a
physical mailing address in every send is a legal requirement.

### 3. Point readers at the signup

Link (or QR-code) this from your site, your email signature, the back page of
your ebook:

```
https://<your-worker>/news/subscribe?list=my-newsletter
```

That page is a minimal form (with a honeypot field for bots). You can also
POST JSON `{list, email, src}` to `/news/subscribe` from your own site's
form. Either way the reader gets a confirmation email and is `pending` until
they click it.

### 4. Send a campaign

Smoke-test to yourself first — `test` sends to that one address only and
never touches the list:

```sh
curl -X POST "$W/news/send?key=$KEY" -H 'content-type: application/json' -d '{
  "list": "my-newsletter",
  "subject": "Issue #1",
  "text": "Hello!\n\nThis is the first issue.",
  "test": "you@example.com"
}'
```

Drop `test` to queue it for real. The cron drains the queue in chunks every
5 minutes; check progress or push it along by hand:

```sh
curl "$W/news/campaign?key=$KEY&id=<id>"   # progress
curl "$W/news/drain?key=$KEY"              # send the next chunk right now
```

`text` is turned into simple paragraph HTML automatically; pass `html` if you
want full control (the unsubscribe footer is appended either way).

### 5. Wire the suppression webhook (recommended)

In the Resend dashboard add a webhook pointing at:

```
https://<your-worker>/news/hook?s=<NEWS_HOOK_SECRET>
```

for the `email.bounced` and `email.complained` events. Set the
`NEWS_HOOK_SECRET` var (any random string — NOT your `TRIGGER_KEY`) so
strangers can't suppress your subscribers with forged bounce events; if the
var is unset the endpoint accepts unsigned posts. Fortmail suppresses
that address across all lists — suppressed and unsubscribed addresses are
never sent to again, even if they're still rows in KV.

## Operating it from an agent (MCP)

Three tools alongside the mail tools at `/mcp`:

| Tool | What it does |
|------|--------------|
| `news_lists` | All lists with total/confirmed subscriber counts |
| `news_send` | Queue a campaign (`list`, `subject`, `text`/`html`) or smoke-test with `test` |
| `news_status` | Recent campaigns + the pending queue; pass `id` for one campaign |

Set the `PUBLIC_HOST` var (this worker's public hostname) so campaigns queued
over MCP can build their unsubscribe links — REST-queued campaigns learn the
hostname from the request and don't need it.

## Endpoints

| Route | Gate | What |
|-------|------|------|
| `GET /news/subscribe?list=` | public | signup form |
| `POST /news/subscribe` | public | create pending sub + send confirmation (honeypot + 10-min resend lock) |
| `GET /news/confirm?t=` | public | double opt-in confirmation |
| `GET/POST /news/unsubscribe?u=` | public | GET shows a button; POST (incl. RFC 8058 one-click) unsubscribes |
| `POST /news/hook` | public | relay webhook → suppress on bounce/complaint |
| `POST /news/relay` | key | seal the relay API key (X-Relay-Key header) |
| `POST /news/list` | key | create/update a list |
| `GET /news/lists` | key | lists + counts |
| `GET /news/subscribers?list=` | key | page through a list's subscribers |
| `POST /news/send` | key | queue a campaign, or `test` to one address |
| `GET /news/campaign?id=` | key | campaign progress / recent campaigns |
| `GET /news/drain` | key | send the next chunk now |

## Data model (all in the one KV store)

```
news:lists                  index of list slugs
news:list:<slug>            {slug, name, from, reply_to, address, created}
news:sub:<slug>:<email>     {email, status, ut, src, created, ...}   status: pending|confirmed|unsubscribed|suppressed
news:ct:<token>             pending confirmation token (48h TTL)
news:ut:<token>             unsubscribe token → {list, email} (durable)
news:camp:<id>              campaign state (status, cursor, sent, errors)
news:campq                  pending campaign queue
news:camps                  recent campaign ids (cap 50)
news:relay                  {type:"resend", sealed:<AES-GCM blob>}   (sealed mode only)
```

Subscriber rows carry `{s: status, ut}` as KV metadata so campaign drains and
counts read the listing, not every row.

## Throughput honesty

`NEWS_BATCH` defaults to 30 per 5-minute tick — comfortably inside the free
plan's ~50-subrequest budget. That's ~360 emails/hour: a 3,000-subscriber
campaign takes ~8 hours to fully drain on free tier. On a paid Workers plan
raise `NEWS_BATCH` (e.g. 300 → ~3,600/hour), and `GET /news/drain?key=` can
always push chunks manually. Newsletters aren't latency-sensitive; the queue
gets there.

# Fortmail setup — the full walkthrough

Everything below happens once. When you're done: your agent reads a triaged
desk, sends as any address you own, and (optionally) wakes up when mail
arrives at its own address.

Notation: `W` = your deployed worker URL (e.g. `https://fortmail.you.workers.dev`),
`KEY` = your `TRIGGER_KEY` secret.

## 0. Deploy the worker

```sh
git clone https://github.com/TheFortThatHolds/mail && cd mail
npx wrangler kv namespace create TOKENS   # paste the id into wrangler.jsonc
npx wrangler secret put TRIGGER_KEY       # a long random string; this is the admin key
npx wrangler deploy
```

Verify: `curl "$W/desk?key=$KEY"` returns `{"ok":true,...}` (an empty desk).

## 1. IMAP mailboxes (any provider)

Fortmail talks IMAP (port 993) and SMTP (port 465) over raw TLS sockets, so
any standards-speaking provider works: Migadu, Fastmail, Purelymail, mailbox.org,
your web host. Two ways in:

### a) You already have the mailbox + password

```sh
curl -H "X-Mailbox-Password: <the password>" \
  "$W/wallet-import?key=$KEY&addr=me@my-domain.com&host=imap.my-provider.com"
```

The password is sealed (AES-GCM) into the worker's KV wallet on arrival and
never stored or logged in plaintext anywhere else.

### b) Mint a fresh sealed password (the sovereign way)

```sh
curl "$W/wallet-provision?key=$KEY&addrs=box1@my-domain.com,box2@my-domain.com&host=imap.my-provider.com"
```

Returns `{provisioned:[{addr, setpw}]}`. Set each `setpw` as that mailbox's
password at your provider (admin panel or API), then forget it — the sealed
copy in the wallet is the working copy. **Do this immediately**: until the
provider-side password matches the sealed one, that box will fail to log in
(and some providers throttle repeated failures for a few minutes).

If your provider's SMTP host isn't just `imap.` → `smtp.` of the same name,
pass `&smtp=smtp.my-provider.com` on either endpoint.

Check what's connected: `curl "$W/imapboxes?key=$KEY"`.

### c) Create a Migadu mailbox without handling its password

Admin routes accept the existing `?key=KEY` authentication or the exact
`Authorization: Bearer KEY` header injected by Fort Card. A missing or incorrect
credential is refused. Use the wallet; never obtain or print the raw admin key.

`POST /wallet-create` takes only JSON `{ "addr": "agent@your-domain.com",
"name": "Agent" }` (maximum 1 KiB). The domain must already have a connected
IMAP account, and the existing Migadu broker configuration must be present.
The mailbox has receiving, sending and IMAP enabled; POP3 and ManageSieve
disabled; no forwarding, invitation, or recovery-email change.

The Worker creates a strong password internally using a domain-separated HMAC
of the existing random wallet key and mailbox address. Concurrent initial
requests therefore use the same password despite KV eventual consistency.
It seals the password before the create-only provider POST, verifies provider
settings and IMAP access, then adds the sealed credential to FortMail. Responses
contain status only. Existing mailboxes, aliases, and unrelated credential
entries are never replaced or reset.

Repeat the identical request to reconcile an interrupted operation. If the
provider mailbox exists, the retained credential is verified before promotion.
An uncertain POST is never repeated against an absent mailbox: the response is
`reconciliation_required`. Preserve `create:<addr>` for diagnosis; do not delete
the mailbox or journal, rotate a password, or import a placeholder to force a
retry. `verify_failed` and `settings_unverified` preserve the sealed state and
can be checked again with the same request. Every successful replay rechecks
Migadu metadata and IMAP rather than trusting a cached `done` flag.

Creation writes its verified sealed credential to the per-address
`imap-created:<addr>` key. That key also supplies the new account index entry.
It never replaces the shared legacy `imapboxes` array or writes the legacy
`imap:<addr>` credential. Account listing unions the legacy array with one
bounded KV prefix listing (up to 1,000 creation entries); truncation is an
explicit error rather than an incomplete successful list. No new bindings
or credential migration is required. Existing legacy credentials take priority
for every read, send, triage and rotation path.

KV reads and prefix listings remain eventually consistent: newly created
accounts may appear after propagation. Success verifies the provider and IMAP
at that moment; it does not freeze provider settings or assert global atomicity.
Concurrent imports/rotations can still race with each other in the existing
legacy lifecycle routes. Creation cannot erase their stored credential or a
different account's index entry, even if it misses those writes on a stale read.
A concurrent lifecycle change can invalidate the just-verified creation password;
the explicit legacy credential takes precedence once its write is visible.
Do not run credential-changing operations concurrently for the same mailbox.
The existing shared-array race between legacy provision/import operations is
unchanged; this route no longer participates in that read/modify/write cycle.

Run `node --check worker.js`, `node test/wallet-create.mjs`, and
`node test/gmail-attachments.mjs` before deployment. Preserve every live binding
and secret, compare uploaded source, and read `/settings` back after deployment.

## 2. Gmail accounts (optional)

Needs a Google OAuth app — one per Fortmail deployment, all your Gmail
accounts connect through it.

1. [Google Cloud Console](https://console.cloud.google.com) → new project →
   enable the **Gmail API**.
2. OAuth consent screen: External, add each Gmail address you'll connect as a
   **test user** (testing mode is fine for personal use — your refresh tokens
   keep working; it's *unverified-app* screens you're avoiding, not function).
3. Credentials → OAuth client ID → **Web application** → authorized redirect
   URI: `https://<your-worker>/oauth/callback`.
4. Give the worker the app:
   ```sh
   npx wrangler secret put GMAIL_CLIENT_ID
   npx wrangler secret put GMAIL_CLIENT_SECRET
   ```
5. Connect each account by opening `$W/connect?key=$KEY` in a browser while
   signed into that account, and approving. `Connected ✓` = its refresh token
   is in the wallet.

Check: `curl "$W/accounts?key=$KEY"`.

## 3. First triage

```sh
curl "$W/triage?key=$KEY&scope=all"     # live sweep of everything, verdicts included
curl "$W/desk?key=$KEY"                 # the cached desk (cron keeps this fresh)
```

The cron sweeps one scope per 5-minute tick (gmail, then each of your IMAP
domains, round-robin) so the desk is always warm without any single run doing
too much. Scopes are derived from whatever boxes you've connected — nothing to
configure.

Triage verdicts, in priority order: muted senders and OTP codes → `ignore`;
urgent/deadline/billing-crisis language → `desk`; bulk/newsletter markers →
`ignore`; soft-money subjects (invoice, appointment, statement) → `desk`;
everything else → `record`. Tune `MUTE_SENDERS` in `wrangler.jsonc` (regex)
to silence known noise; edit the `HARD`/`SOFT` regexes in `worker.js` if your
mail speaks a different dialect — it's your worker.

## 4. Connect your agent (MCP)

Add `https://<your-worker>/mcp` wherever your agent takes MCP servers.
MCP is vendor-neutral, so any MCP-capable agent works. Examples:

- **Claude** — claude.ai → Settings → Connectors → Add custom connector; or
  `claude mcp add --transport http fortmail https://<your-worker>/mcp`
- **ChatGPT / Codex** — add it as a connector (Settings → Connectors) or in
  `~/.codex/config.toml` as an `mcp_servers` entry
- **Cursor / Windsurf / other IDE agents** — add an MCP server entry with the
  URL above (transport: streamable HTTP)
- **Your own harness** — anything that speaks MCP over streamable HTTP with
  OAuth discovery; see [AGENT.md](AGENT.md) § Connection details

The OAuth dance is automatic (dynamic client registration + PKCE); when a
password is asked for, it's your `TRIGGER_KEY`.

The agent gets: `list_accounts`, `get_desk`, `triage`, `read_box`,
`read_message` (body + attachment metadata), `get_attachment` (Gmail
bytes), `send`. HTTP equivalents: `GET /tool?key=&name=read_message&…`
and `GET /attachment?key=&address=&message=&attachmentId=` (raw PDF).
See [AGENT.md](AGENT.md) § Attachments.

## 5. The steward bridge (optional — mail that wakes your agent)

Give your agent its own address and let people (and services, and you) email
it work. Flow: mail arrives → worker files a **GitHub PR** in a log repo →
your agent (subscribed to that repo's PR activity) wakes and handles it.

1. Provision the watch box, e.g. `steward@your-domain.com` (step 1b above).
2. Create a small repo for the log (e.g. `you/agent-mail-log`) with at least
   one commit on `main`.
3. Mint a fine-grained GitHub PAT scoped to ONLY that repo, permissions
   **Contents: write** + **Pull requests: write**, and:
   ```sh
   npx wrangler secret put GITHUB_TOKEN
   ```
4. In `wrangler.jsonc` vars, set and redeploy:
   - `GITHUB_WATCH` = `steward@your-domain.com`
   - `GITHUB_REPO` = `you/agent-mail-log`
   - `OWNER_EMAILS` = your own address(es), comma-separated
5. Test without side effects: `curl "$W/bridge-run?key=$KEY&dry=1"`, then live:
   `curl "$W/bridge-run?key=$KEY"`.
6. Point your agent at the log repo (e.g. keep a session subscribed to its PR
   activity, or a scheduled agent that sweeps open PRs).

Each unseen message becomes one PR titled `[mail] <subject>`, body stamped
TRUSTED/UNTRUSTED (see the trust rule in the README), full text included, and
is marked `\Seen` only after filing succeeds — nothing gets lost to a crash.

## Troubleshooting

- **`login failed` on an IMAP box** — the sealed password doesn't match the
  provider. For Migadu boxes, `/wallet-rotate?key=&addr=` fixes it
  server-side (mint + push + verify, no manual password handling). Otherwise
  re-run `/wallet-provision` for that box and set the new `setpw`
  at the provider (or `/wallet-import` the real one).
- **Gmail `No refresh token`** — Google only issues a refresh token on the
  first consent. Remove the app at `myaccount.google.com/permissions`, then
  `/connect` again.
- **First send from a new box bounces or delays** — greylisting; new senders
  are often deferred a few minutes. Send again.
- **A triage of many boxes times out** — use scoped sweeps (`&scope=`,
  `&domain=`), which is exactly what the cron does; `scope=all` on dozens of
  boxes in one HTTP request is the one known way to hit the wall.


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
`read_message`, `send`.

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
  provider. Re-run `/wallet-provision` for that box and set the new `setpw`
  at the provider (or `/wallet-import` the real one).
- **Gmail `No refresh token`** — Google only issues a refresh token on the
  first consent. Remove the app at `myaccount.google.com/permissions`, then
  `/connect` again.
- **First send from a new box bounces or delays** — greylisting; new senders
  are often deferred a few minutes. Send again.
- **A triage of many boxes times out** — use scoped sweeps (`&scope=`,
  `&domain=`), which is exactly what the cron does; `scope=all` on dozens of
  boxes in one HTTP request is the one known way to hit the wall.

# Fortmail

**Agent-operated email, in one Cloudflare Worker.**

Your AI agent gets a real email client — every account you own, aggregated,
triaged, and sendable-as — and you stop checking inboxes. Fortmail is the
open-source version of the mail system running inside
[The Fort That Holds](https://thefortthatholds.com): one small worker, no
framework, no server to babysit, free-tier friendly.

```
your Gmail(s) ─┐
your domain(s) ─┤→  Fortmail worker  →  triage desk (only what matters)
 (any IMAP)    ─┘        │
                         ├→ MCP server at /mcp  ← your agent connects here
                         └→ steward bridge: email → GitHub PR → wakes your agent
```

## What it does

- **Owns all your mailboxes.** Gmail accounts via the Gmail API (OAuth), and
  any IMAP/SMTP provider (Migadu, Fastmail, Purelymail, your host…) via raw
  TLS sockets — no forwarding rules, no middleman service.
- **Seals its own credentials.** The worker mints its own AES-GCM key and can
  generate + seal a password per mailbox. You never handle, store, or even see
  those passwords — the agent's wallet is the only place they exist.
- **Triages deterministically.** A regex classifier (no LLM, no API cost,
  no hallucination) sorts mail into `desk` (needs a human), `record`
  (worth keeping), `ignore` (bulk/OTP noise). A cron sweeps one scope every
  5 minutes and caches the desk, so reading it is instant.
- **Speaks MCP.** `/mcp` is a Model Context Protocol server with its own
  OAuth (dynamic client registration + PKCE). MCP is vendor-neutral — connect
  any agent that takes an MCP server (Claude, ChatGPT, Gemini, Cursor, your
  own harness) and it gets six tools: `list_accounts`, `get_desk`, `triage`,
  `read_box`, `read_message`, `send`. There is **no LLM inside Fortmail
  itself** — no model dependency, no API key to any AI vendor; the
  intelligence is whatever agent you point at it.
- **Sends as anyone you own.** Gmail via the API, everything else via SMTP —
  transport picked automatically from the `from` address.
- **Wakes your agent on mail** (optional). Give the agent its own address
  (e.g. `steward@your-domain.com`). Every unseen message there becomes a
  GitHub pull request in a repo your agent watches — with the sender stamped
  **TRUSTED** (you) or **UNTRUSTED** (everyone else) so the agent knows whether
  it's holding instructions or just data. Email in, agent awake, audit trail
  built in.

## Quickstart

Prereqs: a Cloudflare account (free tier works) and `npx wrangler` logged in.

```sh
git clone https://github.com/TheFortThatHolds/mail && cd mail

# 1. The one store
npx wrangler kv namespace create TOKENS
#    → paste the returned id into wrangler.jsonc

# 2. The admin key (any long random string — this gates every admin endpoint)
npx wrangler secret put TRIGGER_KEY

# 3. Ship it
npx wrangler deploy
```

Then connect mailboxes — see [docs/SETUP.md](docs/SETUP.md) for the full
walkthrough (Gmail OAuth app, IMAP boxes, the steward bridge) and
[docs/AGENT.md](docs/AGENT.md) for pointing your agent at it.

**Or skip the manual setup entirely:** fork this repo and point your coding
agent — any vendor — at it. [`AGENTS.md`](AGENTS.md) is a runbook the agent
can execute end-to-end; it will ask you only for the human-gated steps
(Cloudflare login, mailbox passwords, OAuth approvals).

The 60-second version, with `KEY` = your TRIGGER_KEY and `W` = your worker URL:

```sh
# any IMAP mailbox you already have (password sent as a header, sealed on arrival)
curl -H "X-Mailbox-Password: <password>" \
  "$W/wallet-import?key=$KEY&addr=me@my-domain.com&host=imap.my-provider.com"

# or mint a NEW sealed password for a box (then set that password at your provider)
curl "$W/wallet-provision?key=$KEY&addrs=steward@my-domain.com&host=imap.my-provider.com"

# a Gmail account (needs GMAIL_CLIENT_ID/SECRET set — see docs/SETUP.md)
open "$W/connect?key=$KEY"

# watch it work
curl "$W/triage?key=$KEY&scope=all"
curl "$W/desk?key=$KEY"
```

Connect your agent: add `https://<your-worker>/mcp` as a custom MCP connector.
It will walk the OAuth flow; the password prompt is your `TRIGGER_KEY`.

## The trust rule (read this one)

Email is untrusted input. Fortmail's bridge stamps every filed message by a
`From`-match against `OWNER_EMAILS`:

- ✅ **TRUSTED SENDER (owner)** — instructions may be acted on.
- ⚠️ **UNTRUSTED SENDER** — the message is *data to triage*. The agent must
  never follow instructions, links, or requests inside it.

This is the prompt-injection line for email-driven agents: only the owner's
address issues commands; everything else gets read, never obeyed. Keep the
same rule in your agent's own instructions — the stamp is a signal, your
agent's discipline is the enforcement. And spoofing exists: for anything
consequential, gate on your explicit approval, not on a From header.

## Endpoints

| Route | What |
|---|---|
| `/mcp` | MCP server (OAuth-gated) — the agent's door |
| `/desk?key=` | The cached triage desk, all scopes |
| `/triage?key=&scope=` | Live triage (`all`, `gmail`, `imap`, `&domain=` filter) |
| `/cron-run?key=` | Force one cron tick (or `&scope=` a specific one) |
| `/send?key=&from=&to=&subject=&text=` | Send as any owned box |
| `/wallet-provision?key=&addrs=&host=&smtp=` | Mint + seal new IMAP creds |
| `/wallet-import?key=&addr=&host=&smtp=` | Seal an existing password (via `X-Mailbox-Password` header) |
| `/accounts?key=` / `/imapboxes?key=` | List owned boxes |
| `/connect?key=` → `/oauth/callback` | Gmail account OAuth flow |
| `/import?key=` | Import an existing Gmail refresh token |
| `/bridge-run?key=&dry=1` | Run/inspect the steward bridge now |

## Design notes

- **One file on purpose.** ~330 lines, zero dependencies, reviewable in one
  sitting. Email holds your whole life; you should be able to read every line
  of the thing that touches it.
- **90-day window** on both Gmail and IMAP (`SINCE` search) so ancient mail
  can never flood the desk.
- **Rotating cron scopes.** Each 5-minute tick sweeps ONE scope (gmail, or one
  domain) — many mailboxes never pile into one timeout.
- **IMAP batching in fours** — Cloudflare serializes concurrent sockets;
  batches keep a sweep fast without tripping limits.
- **No LLM in the loop.** Triage is regex. Your agent applies judgment when it
  reads the desk; the plumbing itself never guesses.

Hardening ideas, threat model, and known limits: [docs/SECURITY.md](docs/SECURITY.md).

## License

[MIT](LICENSE) © The Fort That Holds LLC.

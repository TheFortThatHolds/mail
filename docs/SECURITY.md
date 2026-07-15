# Fortmail security model

What protects what, what the honest limits are, and what to harden if your
threat model is bigger than "my own mail on my own Cloudflare account."

## The layers

| Surface | Gate |
|---|---|
| Admin REST endpoints (`/desk`, `/send`, `/wallet-*`, …) | `TRIGGER_KEY` (`?key=` query param) |
| `/mcp` | Its own OAuth: dynamic client registration, PKCE (S256), bearer tokens in KV (access 1h / refresh 90d). The authorize step asks for `TRIGGER_KEY`. |
| Mailbox passwords | Sealed AES-GCM in KV; the seal key is worker-minted (`wallet_key` in KV) and never leaves the deployment. Nothing returns a stored password. (`/wallet-provision` returns a *newly minted* password exactly once, so you can set it at the provider.) |
| Gmail | Refresh tokens in KV; your own OAuth app; scope is `https://mail.google.com/` (full mail — required for read+send via one grant). |
| Email content → agent | TRUSTED/UNTRUSTED stamping by `From`-match against `OWNER_EMAILS` (see the trust rule in the README). |
| GitHub bridge | Fine-grained PAT you scope to ONE log repo, Contents + Pull requests only. |

## Honest limits (read before you widen the blast radius)

- **The KV namespace is the crown jewels.** Sealed passwords AND the seal key
  live in the same namespace — anyone with write access to your Cloudflare
  account owns your mail. That's the deal with self-hosting on your own
  account: the account IS the perimeter. Don't share the account; do use
  Cloudflare's 2FA.
- **`TRIGGER_KEY` rides in the URL.** Query strings can land in logs (yours,
  and any proxy's). Acceptable for a personal deployment; rotate the key if
  you ever paste a URL somewhere public. Rotation is one
  `wrangler secret put TRIGGER_KEY` away and invalidates nothing else.
- **`From` headers can be forged.** The trust stamp raises the bar; it is not
  cryptographic. SPF/DKIM checking happens at your mail provider before
  Fortmail ever sees the message, which helps — but for consequential actions
  your agent should require your approval in-channel, not just a TRUSTED stamp.
- **OAuth clients self-register** (that's the MCP remote-connector spec), so
  the registration endpoint is open by design; what it gets you is only the
  right to *ask* — the authorize step still demands `TRIGGER_KEY`, and tokens
  only mint after it.
- **No per-tool authorization.** Any authorized MCP client can call `send`.
  If you want a read-only connection for some agent, front `/mcp` with a
  second worker that filters `tools/call` by name — or just don't give that
  agent the key.
- **Plain-text sends only.** No HTML, no attachments outbound. Deliberate:
  smaller surface, and agent mail should read like a person, not a campaign.

## Hardening menu (in rough order of value)

1. **Custom domain + Cloudflare Access** in front of the admin routes — turns
   the query-param key into a second factor instead of the only one.
2. **Move the admin gate to a header** (`Authorization: Bearer`) if URL-borne
   keys bother you; it's a ~5-line change in `fetch()` (`okKey`).
3. **Split KV namespaces** (wallet vs OAuth tokens vs desk cache) to shrink
   what any single leaked binding exposes.
4. **Pin the bridge PAT's expiry short** and rotate on a calendar — it's the
   only credential in the system that grants anything outside your mail.
5. **Log sends.** A one-line `console.log` on `/send` + `tools/call:send`
   gives you an outbound audit trail in Workers observability for free.

## Reporting

Found something real? Open a GitHub issue with enough to reproduce, or email
the address on the repo profile. It's a ~330-line file — patches welcome.

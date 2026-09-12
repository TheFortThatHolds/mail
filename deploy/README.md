# Production snapshot (not the OSS worker)

`fort-mail.live.js` is the **live Fort Mail worker** (`fort-mail` on Cloudflare), not
the open-source `worker.js` at the repo root.

The production script is a superset: MailSteward, `archive`, RAIL/REGISTRY, owner
Google sign-in, `/connect-link`. Replacing it with root `worker.js` would drop
those organs. This snapshot is root `worker.js` attachment support
(`get_attachment`, `read_message.attachments`, `GET /attachment`) merged into
the live Fort script.

SHA of source this snapshot was built from (OSS main): `f96c194f76732b839c1543284bd2c2d8cc152843`

Do not `wrangler deploy` root `worker.js` onto the worker named `fort-mail`.

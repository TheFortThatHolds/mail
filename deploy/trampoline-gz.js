export default {
  async fetch() {
    const PARTS = [
      "https://raw.githubusercontent.com/TheFortThatHolds/mail/cursor/fort-mail-filename-attach/deploy/fort-mail.filename.gz.part0.b64",
      "https://raw.githubusercontent.com/TheFortThatHolds/mail/cursor/fort-mail-filename-attach/deploy/fort-mail.filename.gz.part1.b64",
      "https://raw.githubusercontent.com/TheFortThatHolds/mail/cursor/fort-mail-filename-attach/deploy/fort-mail.filename.gz.part2.b64"
    ];
    const PUT = "https://api.cloudflare.com/client/v4/accounts/eda7ec96bd3ba7a54851d552fcbd24e0/workers/scripts/fort-mail/content";
    const BROKER = "https://card.thefortthatholds.com/agent/use";
    try {
      let b64 = "";
      for (const u of PARTS) {
        const got = await fetch(u);
        const t = await got.text();
        if (!got.ok) return Response.json({ ok:false, error:"bad part", url:u, http:got.status }, { status:500 });
        b64 += t.trim();
      }
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const ds = new DecompressionStream("gzip");
      const script = await new Response(new Blob([bin]).stream().pipeThrough(ds)).text();
      if (!script.includes("gmailFindPartByFilename") || !script.includes("get_attachment") || script.length < 20000) {
        return Response.json({ ok:false, error:"bad script", length:script.length, head:script.slice(0,160) }, { status:500 });
      }
      const b = "FortMailFnAttach9";
      const mp = "--" + b + "\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n{\"main_module\":\"worker.js\"}\r\n--" + b + "\r\nContent-Disposition: form-data; name=\"worker.js\"; filename=\"worker.js\"\r\nContent-Type: application/javascript+module\r\n\r\n" + script + "\r\n--" + b + "--\r\n";
      const r = await fetch(BROKER, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: "TheFortThatHolds/fort-central-config",
          card: "card_7e3fe991",
          request: {
            url: PUT,
            method: "PUT",
            headers: { "Content-Type": "multipart/form-data; boundary=" + b },
            body: mp
          }
        })
      });
      const text = await r.text();
      let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 800) }; }
      const success = !!(j && (j.status === 200 || (j.body && j.body.success)));
      return Response.json({ ok: success, broker_http: r.status, source_bytes: script.length, hasFilename: true, result: j });
    } catch (e) {
      return Response.json({ ok: false, error: String((e && e.message) || e) }, { status: 500 });
    }
  }
};

// Throwaway trampoline: fetch the live snapshot and content-only PUT it to
// worker "fort-mail" via Fort Card card_7e3fe991 so secrets/bindings stay.
export default {
  async fetch() {
    const SRC = "https://raw.githubusercontent.com/TheFortThatHolds/mail/cursor/fort-mail-attach-live-fd37/deploy/fort-mail.live.js";
    const PUT = "https://api.cloudflare.com/client/v4/accounts/eda7ec96bd3ba7a54851d552fcbd24e0/workers/scripts/fort-mail/content";
    const BROKER = "https://card.thefortthatholds.com/agent/use";
    try {
      const got = await fetch(SRC);
      const script = await got.text();
      if (!got.ok || !script.includes("get_attachment") || script.length < 20000) {
        return Response.json({ ok: false, error: "bad source", http: got.status, length: script.length, head: script.slice(0, 120) }, { status: 500 });
      }
      const b = "FortMailLive12";
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
      return Response.json({ ok: success, broker_http: r.status, source_bytes: script.length, result: j });
    } catch (e) {
      return Response.json({ ok: false, error: String((e && e.message) || e) }, { status: 500 });
    }
  }
};

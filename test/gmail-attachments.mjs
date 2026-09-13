// Fixture tests for Gmail/IMAP attachment listing.
// Extracts the walker functions from worker.js (node cannot import cloudflare:sockets).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const root = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(root, "..", "worker.js"), "utf8");

function extract(name) {
  const start = src.indexOf("function " + name);
  if (start < 0) throw new Error("missing function " + name);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unclosed " + name);
}

const fns = new Function(
  [
    "const ub64=(s)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));",
    extract("b64ToText"),
    extract("b64urlToBytes"),
    extract("bytesToB64"),
    extract("safeFilename"),
    extract("gmailWalkPart"),
    extract("gmailWalkAttachments"),
    extract("gmailFindPart"),
    extract("imapWalkAttachments"),
    "return {gmailWalkPart,gmailWalkAttachments,gmailFindPart,imapWalkAttachments,b64urlToBytes,bytesToB64,safeFilename};",
  ].join("\n")
)();

function b64url(s) {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const pdfEmail = {
  mimeType: "multipart/mixed",
  parts: [
    {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", filename: "", body: { data: b64url("Syd — service records attached.") } },
        { mimeType: "text/html", filename: "", body: { data: b64url("<p>Syd — service records attached.</p>") } },
      ],
    },
    {
      filename: "LHM-service-record.pdf",
      mimeType: "application/pdf",
      body: { attachmentId: "ANGjdJ-test-pdf", size: 98765 },
    },
    {
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      body: { attachmentId: "ANGjdJ-test-jpg", size: 2222 },
    },
  ],
};

const body = fns.gmailWalkPart(pdfEmail);
assert.match(body, /service records attached/);
assert.doesNotMatch(body, /<p>/);

const attachments = [];
fns.gmailWalkAttachments(pdfEmail, attachments);
assert.equal(attachments.length, 2);
assert.deepEqual(attachments[0], {
  filename: "LHM-service-record.pdf",
  mimeType: "application/pdf",
  size: 98765,
  attachmentId: "ANGjdJ-test-pdf",
});
assert.equal(attachments[1].filename, "photo.jpg");
assert.equal(fns.gmailFindPart(pdfEmail, "ANGjdJ-test-pdf").filename, "LHM-service-record.pdf");
assert.equal(fns.gmailFindPart(pdfEmail, "missing"), null);

const textOnly = { mimeType: "text/plain", filename: "", body: { data: b64url("just text") } };
const none = [];
fns.gmailWalkAttachments(textOnly, none);
assert.equal(none.length, 0);
assert.equal(fns.gmailWalkPart(textOnly).trim(), "just text");

const txtFile = { filename: "notes.txt", mimeType: "text/plain", body: { attachmentId: "aid-txt", size: 12 } };
const listed = [];
fns.gmailWalkAttachments(txtFile, listed);
assert.equal(listed[0].filename, "notes.txt");

const rawImap = [
  "From: shop@example.com",
  "Subject: records",
  'Content-Type: multipart/mixed; boundary="bnd"',
  "",
  "--bnd",
  "Content-Type: text/plain",
  "",
  "hello",
  "--bnd",
  'Content-Type: application/pdf; name="rec.pdf"',
  'Content-Disposition: attachment; filename="rec.pdf"',
  "",
  "%PDF-fake",
  "--bnd--",
  "",
].join("\r\n");
const imapAtt = [];
fns.imapWalkAttachments(rawImap, imapAtt);
assert.equal(imapAtt.length, 1);
assert.equal(imapAtt[0].filename, "rec.pdf");
assert.equal(imapAtt[0].mimeType, "application/pdf");
assert.equal(imapAtt[0].attachmentId, null);

const plainImap = "From: a@b.com\r\nSubject: x\r\nContent-Type: text/plain\r\n\r\njust a body\r\n";
const noImap = [];
fns.imapWalkAttachments(plainImap, noImap);
assert.equal(noImap.length, 0);

const round = fns.bytesToB64(fns.b64urlToBytes(b64url("hello-pdf")));
assert.equal(Buffer.from(round, "base64").toString("utf8"), "hello-pdf");
assert.equal(fns.safeFilename('bad\nname".pdf'), "bad_name_.pdf");

for (const needle of ["/attachment", "get_attachment", "gmailWalkAttachments", "path===\"/tool\""]) {
  assert.ok(src.includes(needle), "worker.js should contain " + needle);
}

console.log("ok — " + attachments.length + " gmail + " + imapAtt.length + " imap fixtures");

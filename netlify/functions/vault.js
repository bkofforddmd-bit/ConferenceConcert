// /.netlify/functions/vault — the band's encrypted log-in reminders.
//   (band) { action:"get" }        + x-upload-password -> { blob }  (null if none yet)
//   (band) { action:"set", blob }  + x-upload-password -> { ok }
// The browser encrypts the notes with a key derived from the band password
// (AES-GCM, PBKDF2) BEFORE sending, so this function and the bucket only ever
// hold ciphertext: { v, salt, iv, ct } — all base64 strings. Nothing here can
// read the passwords, and neither can anyone who gets hold of the bucket.
const { getJSON, putJSON, json } = require("./_r2");

const VAULT_KEY = "vault/publish-logins.json";
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD;
const B64 = /^[A-Za-z0-9+/=]+$/;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  const pw = event.headers["x-upload-password"] || event.headers["X-Upload-Password"];
  if (!UPLOAD_PASSWORD || pw !== UPLOAD_PASSWORD) return json(401, { error: "Band password required" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Bad JSON" }); }

  if (body.action === "get") {
    const stored = await getJSON(VAULT_KEY, null);
    return json(200, { blob: stored && stored.blob ? stored.blob : null, updatedAt: stored ? stored.updatedAt : null });
  }

  if (body.action === "set") {
    const b = body.blob || {};
    const ok = b && b.v === 1 && [b.salt, b.iv, b.ct].every((x) => typeof x === "string" && B64.test(x))
      && b.salt.length <= 64 && b.iv.length <= 32 && b.ct.length <= 40000;
    if (!ok) return json(400, { error: "Blob must be { v:1, salt, iv, ct } (base64, under 40 KB)" });
    const updatedAt = new Date().toISOString();
    await putJSON(VAULT_KEY, { blob: { v: 1, salt: b.salt, iv: b.iv, ct: b.ct }, updatedAt });
    return json(200, { ok: true, updatedAt });
  }

  return json(400, { error: "Unknown action" });
};

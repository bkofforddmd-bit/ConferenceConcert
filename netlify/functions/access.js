// /.netlify/functions/access — the "request access" gate.
//   (open)  { name, email, talkUrl, note }            -> create an access request (pending)
//   (open)  { action:"redeem", code }                 -> check a code; unlocks the app
//   (band)  { action:"list" }    + x-upload-password  -> all requests
//   (band)  { action:"approve", id }                  -> approve + generate the access code
//   (band)  { action:"deny", id }                     -> deny (code stops working)
//   (band)  { action:"delete", id }                   -> remove
//   (band)  { action:"invite", label }                -> mint a pre-approved code (no request needed)
// Requests live in access.json in R2, same pattern as suggestions.
const { getJSON, putJSON, json } = require("./_r2");

const ACCESS_KEY = "access.json";
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD;

const clip = (s, n) => String(s == null ? "" : s).slice(0, n).trim();
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());

// A sincere request must link a real General Conference talk on churchofjesuschrist.org.
function isConferenceTalkUrl(s) {
  try {
    const u = new URL(String(s || "").trim());
    if (!/(^|\.)churchofjesuschrist\.org$/i.test(u.hostname)) return false;
    return /general-conference/i.test(u.pathname);
  } catch (_) {
    return false;
  }
}

// Friendly, unambiguous codes like "HYMN-4K7Q" (no 0/O/1/I to mistype).
const WORDS = ["SING", "ZION", "CHOIR", "HYMN", "PRAISE", "GLORY", "VOICE", "ECHO"];
const ALPHA = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const normCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function newCode(existing) {
  for (let tries = 0; tries < 50; tries++) {
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    let tail = "";
    for (let i = 0; i < 4; i++) tail += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    const code = word + "-" + tail;
    if (!existing.has(normCode(code))) return code;
  }
  return "GATE-" + Date.now().toString(36).toUpperCase().slice(-6);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Bad JSON" }); }

  const action = body.action || "create";
  const pw = event.headers["x-upload-password"] || event.headers["X-Upload-Password"];
  const isBand = UPLOAD_PASSWORD && pw === UPLOAD_PASSWORD;

  // ---------- Open: redeem a code ----------
  if (action === "redeem") {
    const raw = clip(body.code, 60);
    if (!raw) return json(400, { error: "Enter your access code." });
    // The band password always unlocks the app too.
    if (UPLOAD_PASSWORD && raw === UPLOAD_PASSWORD) return json(200, { ok: true, band: true });
    const store = await getJSON(ACCESS_KEY, { requests: [] });
    const hit = (store.requests || []).find(
      (r) => r.status === "approved" && r.code && normCode(r.code) === normCode(raw)
    );
    if (!hit) return json(404, { error: "That code didn't work. Check for typos, or request access below." });
    hit.redeemedAt = new Date().toISOString();
    hit.redeemCount = (hit.redeemCount || 0) + 1;
    await putJSON(ACCESS_KEY, store);
    return json(200, { ok: true });
  }

  // ---------- Band-only actions ----------
  if (action === "list" || action === "approve" || action === "deny" ||
      action === "delete" || action === "invite") {
    if (!isBand) return json(401, { error: "Wrong or missing password" });
    const store = await getJSON(ACCESS_KEY, { requests: [] });
    store.requests = store.requests || [];

    if (action === "list") return json(200, { requests: store.requests });

    if (action === "invite") {
      const label = clip(body.label, 80) || "Invited guest";
      const existing = new Set(store.requests.map((r) => normCode(r.code)).filter(Boolean));
      const entry = {
        id: "acc_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: label, email: "", talkUrl: "", note: "",
        invited: true,
        createdAt: new Date().toISOString(),
        status: "approved",
        approvedAt: new Date().toISOString(),
        code: newCode(existing),
        redeemCount: 0,
      };
      store.requests.unshift(entry);
      if (store.requests.length > 1000) store.requests.length = 1000;
      await putJSON(ACCESS_KEY, store);
      return json(200, { ok: true, entry });
    }

    const id = clip(body.id, 60);
    if (!id) return json(400, { error: "Missing id" });
    const i = store.requests.findIndex((r) => r.id === id);
    if (i < 0) return json(404, { error: "Not found" });

    if (action === "approve") {
      const r = store.requests[i];
      r.status = "approved";
      r.approvedAt = new Date().toISOString();
      if (!r.code) {
        const existing = new Set(store.requests.map((x) => normCode(x.code)).filter(Boolean));
        r.code = newCode(existing);
      }
      await putJSON(ACCESS_KEY, store);
      return json(200, { ok: true, entry: r });
    }
    if (action === "deny") {
      store.requests[i].status = "denied";
      store.requests[i].deniedAt = new Date().toISOString();
      await putJSON(ACCESS_KEY, store);
      return json(200, { ok: true });
    }
    if (action === "delete") {
      store.requests = store.requests.filter((r) => r.id !== id);
      await putJSON(ACCESS_KEY, store);
      return json(200, { ok: true });
    }
  }

  // ---------- Open: create a request (starts pending) ----------
  const name = clip(body.name, 80);
  const email = clip(body.email, 160).toLowerCase();
  const talkUrl = clip(body.talkUrl, 500);
  const note = clip(body.note, 600);
  if (!name) return json(400, { error: "Please tell us your name." });
  if (!isEmail(email)) return json(400, { error: "Please enter a real email address — that's where your access code will be sent." });
  if (!isConferenceTalkUrl(talkUrl)) {
    return json(400, { error: "That doesn't look like a General Conference talk link. Find your talk at churchofjesuschrist.org and paste its full web address." });
  }

  try {
    const store = await getJSON(ACCESS_KEY, { requests: [] });
    store.requests = store.requests || [];
    const existing = store.requests.find((r) => r.email === email);
    if (existing) {
      // Same person asking again: refresh their details, don't duplicate.
      existing.name = name;
      existing.talkUrl = talkUrl;
      if (note) existing.note = note;
      existing.updatedAt = new Date().toISOString();
      existing.requestCount = (existing.requestCount || 1) + 1;
      await putJSON(ACCESS_KEY, store);
      return json(200, { ok: true });
    }
    store.requests.unshift({
      id: "acc_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, email, talkUrl, note,
      createdAt: new Date().toISOString(),
      status: "pending",
      requestCount: 1,
      redeemCount: 0,
    });
    if (store.requests.length > 1000) store.requests.length = 1000;
    await putJSON(ACCESS_KEY, store);
    return json(200, { ok: true });
  } catch (err) {
    return json(500, { error: "Could not save your request", detail: String(err.message || err) });
  }
};

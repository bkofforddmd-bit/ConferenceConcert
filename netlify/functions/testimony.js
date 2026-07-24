// /.netlify/functions/testimony — human experiences with the talks & music.
//   (open)  { name, email?, text, songId?, songTitle? }  -> share a testimony (starts pending)
//   (open)  { action:"board" }                           -> approved testimonies (no emails)
//   (open)  { action:"amen", id, email }                 -> add an "amen" (email-gated, one each)
//   (band)  { action:"list" }     + x-upload-password    -> ALL testimonies (with emails)
//   (band)  { action:"approve", id, approved }           -> show/hide on the public board
//   (band)  { action:"delete", id }                      -> remove
// Same trust model as suggestions: anyone can share, nothing appears publicly
// until the band approves it. Stored as testimonies.json in R2.
const { getJSON, putJSON, json } = require("./_r2");

const TESTIMONIES_KEY = "testimonies.json";
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD;

const clip = (s, n) => String(s == null ? "" : s).slice(0, n).trim();
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());

// Email stays private — the public board only ever sees these fields.
// Amens are stored as a list of emails (one each) but shown only as a count.
const publicView = (t) => ({
  id: t.id, name: t.name, text: t.text,
  songId: t.songId, songTitle: t.songTitle, createdAt: t.createdAt,
  amens: Array.isArray(t.amens) ? t.amens.length : 0,
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Bad JSON" }); }

  const action = body.action || "create";
  const pw = event.headers["x-upload-password"] || event.headers["X-Upload-Password"];
  const isBand = UPLOAD_PASSWORD && pw === UPLOAD_PASSWORD;

  // ---------- Open: public board (approved only) ----------
  if (action === "board") {
    const store = await getJSON(TESTIMONIES_KEY, { testimonies: [] });
    const list = (store.testimonies || [])
      .filter((t) => t.approved)
      .map(publicView)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return json(200, { testimonies: list });
  }

  // ---------- Open: amen (email-gated, one per email per testimony) ----------
  if (action === "amen") {
    const id = clip(body.id, 60);
    const email = clip(body.email, 160).toLowerCase();
    if (!id) return json(400, { error: "Missing id" });
    if (!isEmail(email)) return json(400, { error: "Please enter a valid email." });
    const store = await getJSON(TESTIMONIES_KEY, { testimonies: [] });
    const t = (store.testimonies || []).find((x) => x.id === id);
    if (!t || !t.approved) return json(404, { error: "Testimony not found" });
    t.amens = Array.isArray(t.amens) ? t.amens : [];
    if (!t.amens.includes(email)) {
      t.amens.push(email);
      if (t.amens.length > 5000) t.amens.length = 5000;
      await putJSON(TESTIMONIES_KEY, store);
    }
    return json(200, { ok: true, amens: t.amens.length });
  }

  // ---------- Band-only actions ----------
  if (action === "list" || action === "approve" || action === "delete") {
    if (!isBand) return json(401, { error: "Wrong or missing password" });
    const store = await getJSON(TESTIMONIES_KEY, { testimonies: [] });
    store.testimonies = store.testimonies || [];

    if (action === "list") return json(200, { testimonies: store.testimonies });

    const id = clip(body.id, 60);
    if (!id) return json(400, { error: "Missing id" });
    const i = store.testimonies.findIndex((t) => t.id === id);
    if (i < 0) return json(404, { error: "Not found" });

    if (action === "approve") {
      store.testimonies[i].approved = !!body.approved;
      await putJSON(TESTIMONIES_KEY, store);
      return json(200, { ok: true });
    }
    if (action === "delete") {
      store.testimonies = store.testimonies.filter((t) => t.id !== id);
      await putJSON(TESTIMONIES_KEY, store);
      return json(200, { ok: true });
    }
  }

  // ---------- Open: share a testimony (starts pending, unapproved) ----------
  const name = clip(body.name, 80) || "A friend";
  const email = clip(body.email, 160).toLowerCase();
  const text = clip(body.text, 1500);
  if (text.length < 10) return json(400, { error: "Please share a few words first." });
  if (email && !isEmail(email)) return json(400, { error: "That email doesn't look right — it's optional, so you can also leave it blank." });

  const entry = {
    id: "tes_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name, email, text,
    songId: clip(body.songId, 80),
    songTitle: clip(body.songTitle, 120),
    createdAt: new Date().toISOString(),
    approved: false,
  };

  try {
    const store = await getJSON(TESTIMONIES_KEY, { testimonies: [] });
    store.testimonies = store.testimonies || [];
    store.testimonies.unshift(entry);
    if (store.testimonies.length > 1000) store.testimonies.length = 1000;
    await putJSON(TESTIMONIES_KEY, store);
    return json(200, { ok: true });
  } catch (err) {
    return json(500, { error: "Could not save your words", detail: String(err.message || err) });
  }
};

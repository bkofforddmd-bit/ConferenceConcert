// POST /.netlify/functions/suggest
//   (open)  { talk, speaker, session, talkUrl, note, from }    -> create a suggestion (pending)
//   (open)  { action:"board" }                                 -> approved suggestions + vote counts
//   (open)  { action:"vote", id, email }                       -> add a "want" vote (email-gated)
//   (band)  { action:"list" }       + x-upload-password        -> ALL suggestions (with voter emails)
//   (band)  { action:"approve", id, approved }                 -> show/hide on the public board
//   (band)  { action:"resolve", id, status }                   -> mark done / reopen
//   (band)  { action:"delete", id }                            -> remove
const { getJSON, putJSON, SUGGESTIONS_KEY, json } = require("./_r2");

const clip = (s, n) => String(s == null ? "" : s).slice(0, n).trim();
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD;
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());

// Strip voter emails before returning to the public; expose only the count.
const publicView = (s) => ({
  id: s.id, talk: s.talk, speaker: s.speaker, session: s.session,
  talkUrl: s.talkUrl, note: s.note, from: s.from, createdAt: s.createdAt,
  wants: Array.isArray(s.voters) ? s.voters.length : 0,
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
    const store = await getJSON(SUGGESTIONS_KEY, { suggestions: [] });
    const list = (store.suggestions || [])
      .filter((s) => s.approved && s.status !== "done")
      .map(publicView)
      .sort((a, b) => b.wants - a.wants || (a.createdAt < b.createdAt ? 1 : -1));
    return json(200, { suggestions: list });
  }

  // ---------- Open: vote (email-gated, one per email per suggestion) ----------
  if (action === "vote") {
    const id = clip(body.id, 60);
    const email = clip(body.email, 160).toLowerCase();
    if (!id) return json(400, { error: "Missing id" });
    if (!isEmail(email)) return json(400, { error: "Please enter a valid email." });
    const store = await getJSON(SUGGESTIONS_KEY, { suggestions: [] });
    const s = (store.suggestions || []).find((x) => x.id === id);
    if (!s || !s.approved) return json(404, { error: "Suggestion not found" });
    s.voters = Array.isArray(s.voters) ? s.voters : [];
    if (!s.voters.includes(email)) {
      s.voters.push(email);
      if (s.voters.length > 5000) s.voters.length = 5000;
      await putJSON(SUGGESTIONS_KEY, store);
    }
    return json(200, { ok: true, wants: s.voters.length });
  }

  // ---------- Band-only actions ----------
  if (action === "list" || action === "approve" || action === "resolve" || action === "delete") {
    if (!isBand) return json(401, { error: "Wrong or missing password" });
    const store = await getJSON(SUGGESTIONS_KEY, { suggestions: [] });
    store.suggestions = store.suggestions || [];

    if (action === "list") {
      // Band sees everything, including voter emails and pending state.
      return json(200, { suggestions: store.suggestions });
    }
    const id = clip(body.id, 60);
    if (!id) return json(400, { error: "Missing id" });
    const i = store.suggestions.findIndex((s) => s.id === id);
    if (i < 0) return json(404, { error: "Not found" });

    if (action === "approve") {
      store.suggestions[i].approved = !!body.approved;
      await putJSON(SUGGESTIONS_KEY, store);
      return json(200, { ok: true });
    }
    if (action === "resolve") {
      store.suggestions[i].status = clip(body.status, 20) || "done";
      await putJSON(SUGGESTIONS_KEY, store);
      return json(200, { ok: true });
    }
    if (action === "delete") {
      store.suggestions = store.suggestions.filter((s) => s.id !== id);
      await putJSON(SUGGESTIONS_KEY, store);
      return json(200, { ok: true });
    }
  }

  // ---------- Open: create a suggestion (starts pending, unapproved) ----------
  const talk = clip(body.talk, 200);
  if (!talk) return json(400, { error: "A talk title is required" });

  const entry = {
    id: "sug_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    talk,
    speaker: clip(body.speaker, 120),
    session: clip(body.session, 80),
    talkUrl: clip(body.talkUrl, 500),
    note:    clip(body.note, 600),
    from:    clip(body.from, 80),
    createdAt: new Date().toISOString(),
    status: "new",
    approved: false,
    voters: [],
  };

  try {
    const store = await getJSON(SUGGESTIONS_KEY, { suggestions: [] });
    store.suggestions = store.suggestions || [];
    store.suggestions.unshift(entry);
    if (store.suggestions.length > 500) store.suggestions.length = 500;
    await putJSON(SUGGESTIONS_KEY, store);
    return json(200, { ok: true, entry: { id: entry.id, talk: entry.talk } });
  } catch (err) {
    return json(500, { error: "Could not save suggestion", detail: String(err.message || err) });
  }
};

// POST /.netlify/functions/suggest
//   (open)  { talk, speaker, session, talkUrl, note, from }  -> saves a suggestion
//   (band)  { action:"list" }     + x-upload-password        -> returns all suggestions
//   (band)  { action:"resolve", id, status }                 -> sets a suggestion's status
//   (band)  { action:"delete", id }                          -> removes a suggestion
const { getJSON, putJSON, SUGGESTIONS_KEY, json } = require("./_r2");

const clip = (s, n) => String(s == null ? "" : s).slice(0, n).trim();
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Bad JSON" }); }

  const action = body.action || "create";

  // ---- Band-only actions (password required) ----
  if (action === "list" || action === "resolve" || action === "delete") {
    const pw = event.headers["x-upload-password"] || event.headers["X-Upload-Password"];
    if (!UPLOAD_PASSWORD || pw !== UPLOAD_PASSWORD) return json(401, { error: "Wrong or missing password" });

    const store = await getJSON(SUGGESTIONS_KEY, { suggestions: [] });
    store.suggestions = store.suggestions || [];

    if (action === "list") {
      return json(200, { suggestions: store.suggestions });
    }
    const id = clip(body.id, 60);
    if (!id) return json(400, { error: "Missing id" });
    if (action === "resolve") {
      const i = store.suggestions.findIndex((s) => s.id === id);
      if (i < 0) return json(404, { error: "Not found" });
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

  // ---- Open action: create a suggestion ----
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
  };

  try {
    const store = await getJSON(SUGGESTIONS_KEY, { suggestions: [] });
    store.suggestions = store.suggestions || [];
    store.suggestions.unshift(entry);
    if (store.suggestions.length > 500) store.suggestions.length = 500;
    await putJSON(SUGGESTIONS_KEY, store);
    return json(200, { ok: true, entry });
  } catch (err) {
    return json(500, { error: "Could not save suggestion", detail: String(err.message || err) });
  }
};

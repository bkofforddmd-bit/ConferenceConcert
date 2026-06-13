// POST /.netlify/functions/suggest
// Body: { talk, speaker, session, note, from }
// Open (no auth). Appends a suggestion to suggestions.json in R2.
const { getJSON, putJSON, SUGGESTIONS_KEY, json } = require("./_r2");

const clip = (s, n) => String(s == null ? "" : s).slice(0, n).trim();

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Bad JSON" }); }

  const talk = clip(body.talk, 200);
  if (!talk) return json(400, { error: "A talk title is required" });

  const entry = {
    id: "sug_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    talk,
    speaker: clip(body.speaker, 120),
    session: clip(body.session, 80),
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

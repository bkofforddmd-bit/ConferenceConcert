// GET /.netlify/functions/data
// Returns the song catalog and the suggestion list. Open (no auth) — read only.
const { getJSON, CATALOG_KEY, SUGGESTIONS_KEY, json } = require("./_r2");

exports.handler = async (event) => {
  // ?companion=<songId> -> that song's talk & lyrics side-by-side map
  const cid = event && event.queryStringParameters && event.queryStringParameters.companion;
  if (cid) {
    const id = String(cid).slice(0, 120).replace(/[^A-Za-z0-9_-]/g, "");
    try {
      const doc = await getJSON(`companion/${id}.json`, null);
      return doc ? json(200, doc) : json(404, { error: "No talk & lyrics view for this song yet" });
    } catch (err) { return json(500, { error: "Could not load", detail: String(err.message || err) }); }
  }
  try {
    const [catalog, suggestions] = await Promise.all([
      getJSON(CATALOG_KEY, { songs: [] }),
      getJSON(SUGGESTIONS_KEY, { suggestions: [] }),
    ]);
    return json(200, { songs: catalog.songs || [], suggestions: suggestions.suggestions || [] });
  } catch (err) {
    return json(500, { error: "Could not load library", detail: String(err.message || err) });
  }
};

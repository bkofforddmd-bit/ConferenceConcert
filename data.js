// GET /.netlify/functions/data
// Returns the song catalog and the suggestion list. Open (no auth) — read only.
const { getJSON, CATALOG_KEY, SUGGESTIONS_KEY, json } = require("./_r2");

exports.handler = async () => {
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

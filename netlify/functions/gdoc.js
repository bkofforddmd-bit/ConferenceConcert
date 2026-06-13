// POST /.netlify/functions/gdoc   { url }
// Takes a Google Doc share link (the Doc must be shared "anyone with the link can view"),
// pulls the document ID, and fetches Google's plain-text export. No auth / no Drive API.
const { json } = require("./_r2");

// Accepts the usual share-link shapes and a bare ID.
function extractDocId(input) {
  const s = String(input || "").trim();
  // /document/d/<ID>/...   or  ?id=<ID>   or a bare 25+ char id
  const m =
    s.match(/\/document\/d\/([a-zA-Z0-9_-]{20,})/) ||
    s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/) ||
    s.match(/^([a-zA-Z0-9_-]{20,})$/);
  return m ? m[1] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Bad JSON" }); }

  const id = extractDocId(body.url);
  if (!id) return json(400, { error: "That doesn't look like a Google Doc link." });

  const exportUrl = `https://docs.google.com/document/d/${id}/export?format=txt`;

  try {
    const resp = await fetch(exportUrl, { redirect: "follow" });

    // A private doc returns an HTML sign-in page (200) or a 401/403, not plain text.
    const ctype = resp.headers.get("content-type") || "";
    if (resp.status === 401 || resp.status === 403) {
      return json(403, { error: "This Doc isn't shared publicly. Set it to “Anyone with the link can view,” then try again." });
    }
    if (!resp.ok) {
      return json(502, { error: `Google returned ${resp.status}. Check the link and sharing settings.` });
    }
    if (/text\/html/i.test(ctype)) {
      return json(403, { error: "This Doc isn't shared publicly. Set it to “Anyone with the link can view,” then try again." });
    }

    let text = await resp.text();
    // Strip a UTF-8 BOM Google sometimes includes, normalize line endings, trim trailing space.
    text = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();

    if (!text) return json(422, { error: "The Doc came back empty." });
    if (text.length > 8000) text = text.slice(0, 8000);

    return json(200, { ok: true, lyrics: text });
  } catch (err) {
    return json(502, { error: "Could not reach Google Docs", detail: String(err.message || err) });
  }
};

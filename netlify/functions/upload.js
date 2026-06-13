// POST /.netlify/functions/upload
// Headers: x-upload-password
// Two actions (no large file ever passes through this function):
//   { action: "sign", filename, contentType }  -> { uploadUrl, publicUrl }
//   { action: "save", song:{...} }             -> appends the song to catalog.json
// Back-compat: a body with { song } and no action is treated as "save".
const { getJSON, putJSON, presignPut, CATALOG_KEY, json } = require("./_r2");

const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD;
const clip = (s, n) => String(s == null ? "" : s).slice(0, n).trim();
const slug = (s) => clip(s, 60).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "song";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const pw = event.headers["x-upload-password"] || event.headers["X-Upload-Password"];
  if (!UPLOAD_PASSWORD || pw !== UPLOAD_PASSWORD) return json(401, { error: "Wrong or missing password" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Bad JSON" }); }

  const action = body.action || (body.song ? "save" : "");

  // ---- 1) Hand out a presigned URL so the browser uploads straight to R2 ----
  if (action === "sign") {
    const ct = clip(body.contentType, 80) || "audio/mpeg";
    if (!/^audio\//.test(ct)) return json(400, { error: "Only audio files are allowed" });
    const ext = (clip(body.filename, 120).match(/\.[a-z0-9]+$/i) || [".mp3"])[0].toLowerCase();
    const base = slug(body.titleHint || body.filename || "song");
    const key = `audio/${base}-${Date.now().toString(36)}${ext}`;
    try {
      const { uploadUrl, publicUrl } = await presignPut(key, ct);
      return json(200, { ok: true, uploadUrl, publicUrl });
    } catch (err) {
      return json(500, { error: "Could not create upload URL", detail: String(err.message || err) });
    }
  }

  // ---- 2) Save the song into the catalog ----
  if (action === "save") {
    const song = body.song || {};
    const title = clip(song.title, 160);
    if (!title) return json(400, { error: "Song title is required" });

    const entry = {
      id: slug(title) + "-" + Date.now().toString(36),
      title,
      talk:    clip(song.talk, 200),
      speaker: clip(song.speaker, 120),
      session: clip(song.session, 80),
      theme:   clip(song.theme, 80),
      style:   clip(song.style, 120),
      talkUrl: clip(song.talkUrl, 500),
      youtube: clip(song.youtube, 200),
      audioUrl: clip(song.audioUrl, 500),
      previewStart: Math.max(0, Math.min(3600, parseInt(song.previewStart, 10) || 0)),
      duration: Math.max(0, Math.min(3600, parseInt(song.duration, 10) || 0)),
      lyrics:  clip(song.lyrics, 8000),
      blurb:   clip(song.blurb, 400),
      addedAt: new Date().toISOString(),
    };

    try {
      const catalog = await getJSON(CATALOG_KEY, { songs: [] });
      catalog.songs = catalog.songs || [];
      catalog.songs.unshift(entry);
      await putJSON(CATALOG_KEY, catalog);
      return json(200, { ok: true, entry });
    } catch (err) {
      return json(500, { error: "Could not update catalog", detail: String(err.message || err) });
    }
  }

  return json(400, { error: "Unknown action" });
};

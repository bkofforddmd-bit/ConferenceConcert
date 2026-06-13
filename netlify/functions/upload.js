// POST /.netlify/functions/upload
// Headers: x-upload-password
// Body (JSON): { filename, contentType, dataBase64, song:{...} }
// Password-gated. Stores the audio file in R2, then appends the song to catalog.json.
const { getJSON, putJSON, putObject, CATALOG_KEY, json } = require("./_r2");

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

  const song = body.song || {};
  const title = clip(song.title, 160);
  if (!title) return json(400, { error: "Song title is required" });

  let audioUrl = clip(song.audioUrl, 500); // allow metadata-only / external-URL entries
  // If an audio file was included, store it.
  if (body.dataBase64) {
    const ct = clip(body.contentType, 80) || "audio/mpeg";
    if (!/^audio\//.test(ct)) return json(400, { error: "Only audio files are allowed" });
    let buf;
    try { buf = Buffer.from(body.dataBase64, "base64"); }
    catch { return json(400, { error: "Could not decode file" }); }
    if (buf.length > 50 * 1024 * 1024) return json(413, { error: "File is larger than 50 MB" });
    const ext = (clip(body.filename, 120).match(/\.[a-z0-9]+$/i) || [".mp3"])[0].toLowerCase();
    const key = `audio/${slug(title)}-${Date.now().toString(36)}${ext}`;
    try { audioUrl = await putObject(key, buf, ct); }
    catch (err) { return json(500, { error: "Upload to storage failed", detail: String(err.message || err) }); }
  }

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
    audioUrl,
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
    return json(500, { error: "Saved file but could not update catalog", detail: String(err.message || err) });
  }
};

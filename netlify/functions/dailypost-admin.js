// /.netlify/functions/dailypost-admin — the band's Daily posts panel (POST, x-upload-password).
//   { action:"status" }                 -> settings, Facebook connection, next 7 in the queue (with drafts), log
//   { action:"toggle", enabled }         -> switch daily posting on/off
//   { action:"draft", songId }           -> write (or rewrite) the draft for a song with Claude
//   { action:"saveDraft", songId, text } -> keep the band's own wording
//   { action:"skip", songId, undo? }     -> leave a song out of the queue (or put it back)
//   { action:"postNow", songId }         -> post that song to Facebook right now
//   { action:"schedule", songId, at }    -> post this song at "YYYY-MM-DDTHH:MM" Eastern ("" clears)
//   { action:"settings", dailyTime }     -> time of day for the daily series, "HH:MM" Eastern
//   { action:"unpost", songId }          -> after deleting the post on Facebook by hand: forget the
//                                           link on the song and mark the log entry, so it queues again
//   Reels (the Studio's vertical video, song.reelUrl), three short steps from the Publish kit:
//   { action:"reelStart", songId }                  -> { videoId }
//   { action:"reelUpload", songId, videoId }        -> Facebook pulls the Reel file from its URL
//   { action:"reelFinish", songId, videoId, text }  -> published; saves song.facebookReel
//   { action:"reelStatus", videoId }                -> processing / publishing status
const { json } = require("./_r2");
const dp = require("./_dailypost");

const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD;
const clip = (s, n) => String(s == null ? "" : s).slice(0, n).trim();

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  const pw = event.headers["x-upload-password"] || event.headers["X-Upload-Password"];
  if (!UPLOAD_PASSWORD || pw !== UPLOAD_PASSWORD) return json(401, { error: "Band password required" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const action = body.action || "status";

  try {
    if (action === "status") {
      const [state, songs, fb] = await Promise.all([dp.loadState(), dp.loadSongs(), dp.fbCheck()]);
      const queue = dp.buildQueue(songs, state, { includeScheduled: true });
      return json(200, {
        enabled: state.enabled, lastRunAt: state.lastRunAt,
        dailyTime: state.dailyTime || dp.DEFAULT_DAILY_TIME, nowLocal: dp.localDateTime(Date.now()),
        schedule: state.schedule || {},
        facebook: fb, claude: !!process.env.ANTHROPIC_API_KEY, appUrl: dp.APP_URL,
        queueLength: queue.length,
        next: queue.slice(0, 7).map((s) => ({ id: s.id, title: s.title, speaker: s.speaker, session: s.session,
          talk: s.talk, talkUrl: s.talkUrl, draft: state.drafts[s.id] || null, scheduledAt: (state.schedule || {})[s.id] || null })),
        skipped: (state.skipped || []).map((id) => { const s = songs.find((x) => x.id === id); return { id, title: s ? s.title : id }; }),
        log: state.log.slice(0, 30),
      });
    }
    if (action === "toggle") {
      const state = await dp.loadState();
      state.enabled = !!body.enabled;
      await dp.saveState(state);
      return json(200, { ok: true, enabled: state.enabled });
    }
    if (action === "draft") {
      const songId = clip(body.songId, 120);
      const songs = await dp.loadSongs();
      const song = songs.find((s) => s.id === songId);
      if (!song) return json(404, { error: "Song not found" });
      const text = await dp.draftPost(song);
      const state = await dp.loadState();
      state.drafts[songId] = { text, source: "claude", at: new Date().toISOString() };
      await dp.saveState(state);
      return json(200, { ok: true, draft: state.drafts[songId], preview: dp.composePost(song, text) });
    }
    if (action === "saveDraft") {
      const songId = clip(body.songId, 120), text = clip(body.text, 4000);
      if (!songId || !text) return json(400, { error: "Need songId and text" });
      const state = await dp.loadState();
      state.drafts[songId] = { text, source: "band", at: new Date().toISOString() };
      await dp.saveState(state);
      return json(200, { ok: true, draft: state.drafts[songId] });
    }
    if (action === "skip") {
      const songId = clip(body.songId, 120);
      const state = await dp.loadState();
      state.skipped = (state.skipped || []).filter((id) => id !== songId);
      if (!body.undo) state.skipped.push(songId);
      await dp.saveState(state);
      return json(200, { ok: true, skipped: state.skipped });
    }
    if (action === "schedule") {
      const songId = clip(body.songId, 120), at = clip(body.at, 16);
      if (!songId) return json(400, { error: "Need songId" });
      if (at && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) return json(400, { error: "Time must look like 2026-10-27T09:30" });
      const state = await dp.loadState();
      if (!state.schedule) state.schedule = {};
      if (at) { state.schedule[songId] = at; state.skipped = (state.skipped || []).filter((id) => id !== songId); }
      else delete state.schedule[songId];
      await dp.saveState(state);
      return json(200, { ok: true, schedule: state.schedule });
    }
    if (action === "settings") {
      const t = clip(body.dailyTime, 5);
      if (!/^\d{2}:\d{2}$/.test(t)) return json(400, { error: "Time must look like 09:30" });
      const state = await dp.loadState();
      state.dailyTime = t;
      await dp.saveState(state);
      return json(200, { ok: true, dailyTime: t });
    }
    if (action === "unpost") {
      const songId = clip(body.songId, 120);
      if (!songId) return json(400, { error: "Need songId" });
      const { getJSON, putJSON, CATALOG_KEY } = require("./_r2");
      const catalog = await getJSON(CATALOG_KEY, { songs: [] });
      const i = (catalog.songs || []).findIndex((s) => s.id === songId);
      if (i < 0) return json(404, { error: "Song not found" });
      catalog.songs[i].facebook = "";
      catalog.songs[i].updatedAt = new Date().toISOString();
      await putJSON(CATALOG_KEY, catalog);
      const state = await dp.loadState();
      let n = 0;
      state.log.forEach((l) => { if (l.songId === songId && l.status === "posted") { l.status = "unposted"; l.unpostedAt = new Date().toISOString(); n++; } });
      state.skipped = (state.skipped || []).filter((id) => id !== songId);
      await dp.saveState(state);
      return json(200, { ok: true, title: catalog.songs[i].title, logEntries: n });
    }
    if (action === "postNow") {
      const songId = clip(body.songId, 120);
      if (!songId) return json(400, { error: "Need songId" });
      const result = await dp.runOnce({ force: true, songId });
      return json(result.error ? 502 : 200, result);
    }
    if (action === "reelStart" || action === "reelUpload" || action === "reelFinish") {
      const songId = clip(body.songId, 120);
      const songs = await dp.loadSongs();
      const song = songs.find((s) => s.id === songId);
      if (!song) return json(404, { error: "Song not found" });
      if (!song.reelUrl) return json(400, { error: "This song has no Reel yet - publish it from the Studio with the Reel" });
      if (action === "reelStart") return json(200, await dp.fbReelStart());
      const videoId = clip(body.videoId, 60);
      if (!/^[0-9]+$/.test(videoId)) return json(400, { error: "Need the videoId from reelStart" });
      if (action === "reelUpload") return json(200, await dp.fbReelUpload(videoId, song.reelUrl));
      const text = clip(body.text, 2200);
      const posted = await dp.fbReelFinish(videoId, text);
      // remember it on the song (Publish kit check mark) and in the panel log;
      // status "reel" (not "posted") so the daily video queue is unaffected
      const { getJSON, putJSON, CATALOG_KEY } = require("./_r2");
      const catalog = await getJSON(CATALOG_KEY, { songs: [] });
      const i = (catalog.songs || []).findIndex((s) => s.id === songId);
      const at = new Date().toISOString();
      if (i >= 0) { catalog.songs[i].facebookReel = posted.url; catalog.songs[i].updatedAt = at; await putJSON(CATALOG_KEY, catalog); }
      const state = await dp.loadState();
      state.log.unshift({ date: dp.localDate(), at, status: "reel", songId, title: song.title, fbId: posted.id, url: posted.url, text });
      state.log = state.log.slice(0, 200);
      await dp.saveState(state);
      return json(200, { ok: true, ...posted });
    }
    if (action === "reelStatus") {
      const videoId = clip(body.videoId, 60);
      if (!/^[0-9]+$/.test(videoId)) return json(400, { error: "Need a videoId" });
      return json(200, await dp.fbReelStatus(videoId));
    }
    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

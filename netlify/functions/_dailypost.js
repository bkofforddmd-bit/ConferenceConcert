// Shared core for the daily Facebook post: one song a day, newest conference
// first, in speaking order. Used by daily-post.js (the scheduled job) and
// dailypost-admin.js (the band panel).
//
// State lives in R2 as dailypost.json:
//   { enabled, drafts:{songId:{text,source,at}}, skipped:[songId], log:[...], lastRunAt }
// Facebook: a Page video post via the Graph API with file_url pointing at the
// song MP4 (Facebook pulls the file itself; nothing streams through here).
// Env: FB_PAGE_ID, FB_PAGE_TOKEN (long-lived Page token), ANTHROPIC_API_KEY,
// APP_URL (optional, defaults to the live site).
const { getJSON, putJSON, CATALOG_KEY } = require("./_r2");

const STATE_KEY = "dailypost.json";
const GRAPH = "https://graph.facebook.com/v21.0";
const APP_URL = (process.env.APP_URL || "https://conferenceconcert.netlify.app/").replace(/\/?$/, "/");
const TZ = "America/New_York";

const clip = (s, n) => String(s == null ? "" : s).slice(0, n).trim();
// Eastern wall-clock "YYYY-MM-DDTHH:MM" — schedule times are stored this way,
// so comparing strings compares moments, and DST takes care of itself.
function localDateTime(ms) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms || Date.now()));
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
function localDate(ms) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(ms || Date.now()));
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

// ---------- state ----------
const DEFAULT_DAILY_TIME = "07:00"; // Eastern — the one posting time for everything (see netlify.toml)
// A schedule entry is a date ("2026-10-27"); it is due once that day's posting
// time has arrived. Older entries with a time ("2026-10-27T09:30") still work.
function scheduleDue(at, nowLocal, postTime) {
  if (!at) return false;
  return at.length === 10 ? (at + "T" + postTime) <= nowLocal : at <= nowLocal;
}
const emptyState = () => ({ enabled: false, dailyTime: DEFAULT_DAILY_TIME, schedule: {}, drafts: {}, skipped: [], log: [], lastRunAt: null });
async function loadState() {
  const s = await getJSON(STATE_KEY, null);
  return Object.assign(emptyState(), s || {});
}
const saveState = (s) => putJSON(STATE_KEY, s);
async function loadSongs() {
  const c = await getJSON(CATALOG_KEY, { songs: [] });
  return c.songs || [];
}

// ---------- which conference, which order (mirrors the app gcOrderKey/confOf) ----------
const MONTHS = ["", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function confOf(song) {
  const u = String(song.talkUrl || "");
  let m = u.match(/general-conference\/(\d{4})\/(\d{2})\/(\d{2,3})[a-z-]/i);
  if (m) {
    const n = m[3], sess = +n[0], talk = +(n.length === 2 ? n[1] : n.slice(1));
    return { year: +m[1], month: +m[2], order: sess * 100 + talk };
  }
  m = u.match(/general-conference\/(\d{4})\/(\d{2})\//i);
  if (m) return { year: +m[1], month: +m[2], order: 0 };
  const txt = String(song.session || "").toLowerCase();
  const y = txt.match(/\b(?:19|20)\d{2}\b/);
  const mi = MONTHS.findIndex((nm, i) => i > 0 && txt.includes(nm.slice(0, 3)));
  return { year: y ? +y[0] : 0, month: mi > 0 ? mi : 0, order: 0 };
}
// Songs still to post: have a video, not yet on Facebook, not skipped.
// Newest conference first; inside a conference, the order the talks were given.
function buildQueue(songs, state, opts) {
  const posted = new Set(state.log.filter((l) => l.status === "posted").map((l) => l.songId));
  const skipped = new Set(state.skipped || []);
  const scheduled = state.schedule || {};
  return songs
    .filter((s) => s.videoUrl && !s.facebook && !posted.has(s.id) && !skipped.has(s.id) && !(opts && opts.includeScheduled) && !scheduled[s.id]
      || (opts && opts.includeScheduled && s.videoUrl && !s.facebook && !posted.has(s.id) && !skipped.has(s.id)))
    .map((s) => ({ s, c: confOf(s) }))
    .sort((a, b) => (b.c.year - a.c.year) || (b.c.month - a.c.month) || (a.c.order - b.c.order)
      || String(a.s.title).localeCompare(String(b.s.title)))
    .map((x) => x.s);
}

// ---------- the words ----------
async function talkText(url) {
  if (!url) return "";
  try {
    const r = await require("./talk-text").handler({ httpMethod: "POST", body: JSON.stringify({ url }) });
    if (r.statusCode !== 200) return "";
    return (JSON.parse(r.body).text || "").slice(0, 24000);
  } catch (_) { return ""; }
}

const SYSTEM = `You write short Facebook posts for "Conference as a Concert": a few friends who take General Conference talks (The Church of Jesus Christ of Latter-day Saints) and set them to music, then share the songs free in a small app. Each post introduces one song.

Voice: a quiet note from one person to a friend. Sincere, plain, unpolished, a little vulnerable. Write as "I". Short sentences, ordinary words, nothing clever. No hype, no sales words, no exclamation marks, no emoji.

Length: 50 to 85 words, in three parts separated by blank lines.
1. One thing the speaker said that I keep thinking about, and the small, honest reason it landed in my own life (one concrete detail, not a lesson).
2. One sentence offering the song I made from the talk, and one sentence encouraging the reader to read or listen to the speaker’s full talk, which is worth more than the song. Do not write URLs; the links are added after your text.
3. On its own final line: ONE short, genuine question to the reader that invites a reply. Vary it from post to post. Examples of the kind: what part of the song they liked best; how well the song matched the talk; which line of the talk stayed with them; whether they heard the talk live and what they remember. The post must end with that question mark.

Rules: name the speaker once, naturally (for example "Elder Gong said"); the talk title is optional. Quote at most four words from the talk, or none. Do not invent facts, stories or quotes that are not in the talk; the personal detail must stay general enough to be true of almost anyone, and it should come from the talk itself (what the speaker describes), not from a stock scene. Vary it from post to post. No hashtags, no headings, no bullet points, no sign-off. Output only the post text.`;

async function draftPost(song, opts) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic();
  const talk = opts && opts.talk != null ? opts.talk : await talkText(song.talkUrl);
  const who = song.speaker && song.speaker !== "—" ? song.speaker : "the speaker";
  const user = [
    `Song title: ${song.title}`,
    `Talk: "${song.talk || song.title}" by ${who}${song.session ? ` (${song.session} General Conference)` : ""}`,
    song.blurb ? `What we said about the song: ${song.blurb}` : "",
    song.lyrics ? `Lyrics:\n${clip(song.lyrics, 3000)}` : "",
    talk ? `Full talk text:\n${talk}` : "(The talk text could not be fetched. Work from the title, speaker and lyrics only, and stay general rather than inventing specifics.)",
  ].filter(Boolean).join("\n\n");
  const res = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") throw new Error("The writing model declined this one" + (res.stop_details && res.stop_details.explanation ? ": " + res.stop_details.explanation : "."));
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!text) throw new Error("Empty draft");
  return text;
}

// The draft plus the links, exactly as it will appear on Facebook. The post
// always ends with a question to the reader: the writer puts one on its final
// line (we move it below the links); a draft without one gets a stock question.
const STOCK_QUESTIONS = [
  "What part of the song did you like best?",
  (who) => "How well did this song match " + who + "\u2019s talk?",
  "Which line stayed with you?",
  (who) => "Did you hear " + who + "\u2019s talk live? What do you remember from it?",
];
function composePost(song, draft) {
  const songUrl = APP_URL + "?song=" + encodeURIComponent(song.id);
  const who = song.speaker && song.speaker !== "\u2014" ? song.speaker : "the speaker";
  const paras = String(draft || "").trim().split(/\n\s*\n/);
  let question = "";
  const last = paras[paras.length - 1].trim();
  if (paras.length > 1 && /\?$/.test(last) && last.length <= 160) { question = last; paras.pop(); }
  if (!question) {
    let h = 0; for (const ch of String(song.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const q = STOCK_QUESTIONS[h % STOCK_QUESTIONS.length];
    question = typeof q === "function" ? q(who) : q;
  }
  return paras.join("\n\n").trim()
    + "\n\n\u25B6 Listen and sing along: " + songUrl
    + (song.talkUrl ? "\n\uD83D\uDCD6 Read " + who + "\u2019s full talk: " + song.talkUrl : "")
    + "\n\n" + question
    + "\n\n#GeneralConference #ConferenceAsAConcert";
}

// ---------- Facebook ----------
function fbEnv() {
  return { pageId: process.env.FB_PAGE_ID || "", token: process.env.FB_PAGE_TOKEN || "" };
}
// Work out which Page to post as, from whatever token was configured.
// A Page token is what we want. If the band pasted their personal (user)
// token instead, which is easy to do in the Graph Explorer, we look up the
// Pages that person manages and use that Page own token, so posting still
// works. The panel then shows the Page token so it can be made permanent.
async function resolvePage() {
  const { pageId, token } = fbEnv();
  if (!token) return { ok: false, error: "FB_PAGE_TOKEN is not set in Netlify" };
  const get = async (path) => {
    const r = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error ? d.error.message : "Facebook returned HTTP " + r.status);
    return d;
  };
  try {
    let pages = [];
    try { pages = (await get("me/accounts?fields=id,name,link,access_token&limit=100")).data || []; } catch (_) { pages = []; }
    if (pages.length) {
      const pick = pages.find((p) => p.id === pageId) || pages.find((p) => /concert/i.test(p.name)) || (pages.length === 1 ? pages[0] : null);
      if (!pick) return { ok: false, error: "This personal token manages " + pages.length + " Pages. Set FB_PAGE_ID to the right one: " + pages.map((p) => p.name + " (" + p.id + ")").join(", ") };
      // What did the person actually grant? A Page token inherits exactly these.
      let granted = [];
      try { granted = ((await get("me/permissions")).data || []).filter((x) => x.status === "granted").map((x) => x.permission); } catch (_) {}
      return { ok: true, pageId: pick.id, token: pick.access_token, name: pick.name, link: pick.link, viaUser: true, granted };
    }
    // A Page token answers /me with the Page itself (Pages have a category; people do not).
    let me;
    try { me = await get("me?fields=id,name,link,category"); }
    catch (_) { return { ok: false, error: "This is a personal token and the account manages no Facebook Page. Create the Page, then generate a Page token." }; }
    return { ok: true, pageId: me.id, token, name: me.name, link: me.link, viaUser: false };
  } catch (err) { return { ok: false, error: err.message }; }
}
async function fbCheck() {
  const pg = await resolvePage();
  if (!pg.ok) return pg;
  const NEEDED = ["pages_show_list", "pages_read_engagement", "pages_manage_posts"];
  const granted = pg.granted || null;
  return { ok: true, name: pg.name, link: pg.link, pageId: pg.pageId, viaUser: pg.viaUser,
    pageToken: pg.viaUser ? pg.token : undefined,
    permissions: granted ? NEEDED.map((k) => ({ name: k, ok: granted.includes(k) })) : null,
    missing: granted ? NEEDED.filter((k) => !granted.includes(k)) : [] };
}
async function fbPostVideo(song, description) {
  const pg = await resolvePage();
  if (!pg.ok) throw new Error("Facebook is not connected: " + pg.error);
  const body = new URLSearchParams({ access_token: pg.token, file_url: song.videoUrl, description,
    title: clip(song.title, 100) });
  const r = await fetch(`${GRAPH}/${pg.pageId}/videos`, { method: "POST", body });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error("Facebook: " + (d.error ? d.error.message : "HTTP " + r.status));
  return { id: d.id, url: `https://www.facebook.com/${pg.pageId}/videos/${d.id}/` };
}

// ---------- Facebook Reels (the vertical 9:16 video from the Studio) ----------
// Meta's Reels publishing flow, in three short calls so each request stays
// well inside the function time limit: start (get a video id), upload (Facebook
// pulls the file from its public URL itself), finish (publish with the caption).
// Same Page token and permissions as the daily posts (pages_manage_posts).
const RUPLOAD = "https://rupload.facebook.com/video-upload/v21.0";
async function fbForm(url, params) {
  const r = await fetch(url, { method: "POST", body: new URLSearchParams(params) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error("Facebook: " + (d.error ? d.error.message : "HTTP " + r.status));
  return d;
}
async function page() {
  const pg = await resolvePage();
  if (!pg.ok) throw new Error("Facebook is not connected: " + pg.error);
  return pg;
}
async function fbReelStart() {
  const pg = await page();
  const d = await fbForm(`${GRAPH}/${pg.pageId}/video_reels`, { upload_phase: "start", access_token: pg.token });
  if (!d.video_id) throw new Error("Facebook did not return a video id");
  return { videoId: String(d.video_id) };
}
async function fbReelUpload(videoId, fileUrl) {
  const pg = await page();
  const r = await fetch(`${RUPLOAD}/${encodeURIComponent(videoId)}`, { method: "POST",
    headers: { Authorization: "OAuth " + pg.token, file_url: fileUrl } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error || d.success === false) throw new Error("Facebook upload: " + (d.error ? (d.error.message || JSON.stringify(d.error)) : d.debug_info ? d.debug_info.message : "HTTP " + r.status));
  return { ok: true };
}
async function fbReelFinish(videoId, description) {
  const pg = await page();
  const d = await fbForm(`${GRAPH}/${pg.pageId}/video_reels`, { upload_phase: "finish", video_id: videoId,
    video_state: "PUBLISHED", description, access_token: pg.token });
  if (d.success === false) throw new Error("Facebook did not accept the Reel");
  return { id: videoId, url: `https://www.facebook.com/reel/${videoId}` };
}
async function fbReelStatus(videoId) {
  const pg = await page();
  const r = await fetch(`${GRAPH}/${encodeURIComponent(videoId)}?fields=status,permalink_url&access_token=${encodeURIComponent(pg.token)}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error("Facebook: " + (d.error ? d.error.message : "HTTP " + r.status));
  const st = d.status || {};
  return { videoStatus: st.video_status || "", processing: st.processing_phase && st.processing_phase.status || "",
    publishing: st.publishing_phase && st.publishing_phase.status || "",
    url: d.permalink_url ? (/^https?:/.test(d.permalink_url) ? d.permalink_url : "https://www.facebook.com" + d.permalink_url) : "" };
}

// ---------- one run ----------
// opts: { force (post now: ignore the switch and the clock), songId (post this one), deps (test doubles) }
// Without force (the half-hourly check): first any song whose scheduled time
// has come, then the daily series once a day at its time of day.
async function runOnce(opts = {}) {
  const deps = Object.assign({ loadState, saveState, loadSongs, draftPost, fbPostVideo, now: Date.now }, opts.deps || {});
  const state = await deps.loadState();
  if (!state.schedule) state.schedule = {};
  const today = localDate(deps.now());
  const nowLocal = localDateTime(deps.now());
  let via = opts.force ? "manual" : "daily";
  let songs = null, song = null;
  if (!opts.force) {
    const postTime = state.dailyTime || DEFAULT_DAILY_TIME;
    const due = Object.entries(state.schedule).filter(([, at]) => scheduleDue(at, nowLocal, postTime)).sort((a, b) => (a[1] < b[1] ? -1 : 1));
    if (due.length) {
      songs = await deps.loadSongs();
      for (const [id] of due) {
        const s = songs.find((x) => x.id === id);
        if (s && s.videoUrl && !s.facebook) { song = s; via = "scheduled"; break; }
        delete state.schedule[id]; // gone, posted elsewhere, or no video: drop the stale schedule
      }
    }
    if (!song) {
      if (!state.enabled) { if (due.length) await deps.saveState(state); return { skipped: "Daily posting is switched off" }; }
      const dailyTime = state.dailyTime || DEFAULT_DAILY_TIME;
      if (nowLocal.slice(11) < dailyTime) return { skipped: "Not yet " + dailyTime + " Eastern" };
      if (state.log.some((l) => l.status === "posted" && (l.via || "daily") !== "scheduled" && l.date === today)) return { skipped: "Already posted today" };
    }
  }
  if (!songs) songs = await deps.loadSongs();
  const queue = buildQueue(songs, state);
  if (!song) song = opts.songId ? songs.find((s) => s.id === opts.songId) : queue[0];
  state.lastRunAt = new Date(deps.now()).toISOString();
  if (!song) {
    state.log.unshift({ date: today, at: state.lastRunAt, status: "empty", note: "Nothing left to post: every video is on Facebook" });
    state.log = state.log.slice(0, 200);
    await deps.saveState(state);
    return { skipped: "Queue is empty" };
  }
  if (!song.videoUrl) return { error: "That song has no video" };
  try {
    const draft = (state.drafts[song.id] && state.drafts[song.id].text) || await deps.draftPost(song);
    const text = composePost(song, draft);
    const posted = await deps.fbPostVideo(song, text);
    // remember where it went: on the song (so the Publish kit shows a check) and in the log
    const catalog = await getJSON(CATALOG_KEY, { songs: [] });
    const i = (catalog.songs || []).findIndex((s) => s.id === song.id);
    if (i >= 0) { catalog.songs[i].facebook = posted.url; catalog.songs[i].updatedAt = state.lastRunAt; await putJSON(CATALOG_KEY, catalog); }
    delete state.drafts[song.id];
    delete state.schedule[song.id];
    state.log.unshift({ date: today, at: state.lastRunAt, status: "posted", via, songId: song.id, title: song.title,
      fbId: posted.id, url: posted.url, text });
    state.log = state.log.slice(0, 200);
    await deps.saveState(state);
    return { posted: { songId: song.id, title: song.title, url: posted.url } };
  } catch (err) {
    if (via === "scheduled") delete state.schedule[song.id]; // don't retry every half hour; the log says why
    state.log.unshift({ date: today, at: state.lastRunAt, status: "error", via, songId: song.id, title: song.title, error: err.message });
    state.log = state.log.slice(0, 200);
    await deps.saveState(state);
    return { error: err.message, songId: song.id, title: song.title };
  }
}

module.exports = { STATE_KEY, APP_URL, DEFAULT_DAILY_TIME, scheduleDue, localDate, localDateTime, loadState, saveState, loadSongs, confOf, buildQueue,
  talkText, draftPost, composePost, resolvePage, fbCheck, fbPostVideo, runOnce,
  fbReelStart, fbReelUpload, fbReelFinish, fbReelStatus };

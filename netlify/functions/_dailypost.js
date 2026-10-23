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
function localDate(ms) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(ms || Date.now()));
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

// ---------- state ----------
const emptyState = () => ({ enabled: false, drafts: {}, skipped: [], log: [], lastRunAt: null });
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
function buildQueue(songs, state) {
  const posted = new Set(state.log.filter((l) => l.status === "posted").map((l) => l.songId));
  const skipped = new Set(state.skipped || []);
  return songs
    .filter((s) => s.videoUrl && !s.facebook && !posted.has(s.id) && !skipped.has(s.id))
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

Voice: sincere, plain, a little unpolished, the way a thoughtful friend talks, not a marketer. First person plural ("we"). No hype, no sales words, no exclamation marks, at most one emoji and only if it feels natural. Short sentences. Ordinary words.

Shape (90 to 160 words, 3 short paragraphs):
1. One thing the speaker said that stayed with us, in our own words, with at most one short quoted phrase from the talk.
2. Why it matters in ordinary life right now: a concrete, everyday reason, not a platitude.
3. One quiet sentence inviting people to listen to the song (the link is added after your text, so do not write a URL).

Rules: name the speaker and the talk title once. Do not invent facts, stories or quotes that are not in the talk. No hashtags, no "link in bio", no headings, no bullet points. Output only the post text.`;

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

// The draft plus the links, exactly as it will appear on Facebook.
function composePost(song, draft) {
  const songUrl = APP_URL + "?song=" + encodeURIComponent(song.id);
  return draft.trim()
    + "\n\n▶ Listen and sing along: " + songUrl
    + (song.talkUrl ? "\n📖 Read the talk: " + song.talkUrl : "")
    + "\n\n#GeneralConference #ConferenceAsAConcert";
}

// ---------- Facebook ----------
function fbEnv() {
  return { pageId: process.env.FB_PAGE_ID || "", token: process.env.FB_PAGE_TOKEN || "" };
}
async function fbCheck() {
  const { pageId, token } = fbEnv();
  if (!pageId || !token) return { ok: false, error: "FB_PAGE_ID / FB_PAGE_TOKEN are not set in Netlify" };
  try {
    const r = await fetch(`${GRAPH}/${pageId}?fields=name,link&access_token=${encodeURIComponent(token)}`);
    const d = await r.json();
    if (!r.ok || d.error) return { ok: false, error: d.error ? d.error.message : "Facebook returned HTTP " + r.status };
    return { ok: true, name: d.name, link: d.link };
  } catch (err) { return { ok: false, error: err.message }; }
}
async function fbPostVideo(song, description) {
  const { pageId, token } = fbEnv();
  if (!pageId || !token) throw new Error("Facebook is not connected (FB_PAGE_ID / FB_PAGE_TOKEN)");
  const body = new URLSearchParams({ access_token: token, file_url: song.videoUrl, description,
    title: clip(song.title, 100) });
  const r = await fetch(`${GRAPH}/${pageId}/videos`, { method: "POST", body });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error("Facebook: " + (d.error ? d.error.message : "HTTP " + r.status));
  return { id: d.id, url: `https://www.facebook.com/${pageId}/videos/${d.id}/` };
}

// ---------- one run ----------
// opts: { force (ignore enabled + once-a-day), songId (post this one), deps (test doubles) }
async function runOnce(opts = {}) {
  const deps = Object.assign({ loadState, saveState, loadSongs, draftPost, fbPostVideo, now: Date.now }, opts.deps || {});
  const state = await deps.loadState();
  const today = localDate(deps.now());
  if (!opts.force) {
    if (!state.enabled) return { skipped: "Daily posting is switched off" };
    if (state.log.some((l) => l.status === "posted" && l.date === today)) return { skipped: "Already posted today" };
  }
  const songs = await deps.loadSongs();
  const queue = buildQueue(songs, state);
  const song = opts.songId ? songs.find((s) => s.id === opts.songId) : queue[0];
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
    state.log.unshift({ date: today, at: state.lastRunAt, status: "posted", songId: song.id, title: song.title,
      fbId: posted.id, url: posted.url, text });
    state.log = state.log.slice(0, 200);
    await deps.saveState(state);
    return { posted: { songId: song.id, title: song.title, url: posted.url } };
  } catch (err) {
    state.log.unshift({ date: today, at: state.lastRunAt, status: "error", songId: song.id, title: song.title, error: err.message });
    state.log = state.log.slice(0, 200);
    await deps.saveState(state);
    return { error: err.message, songId: song.id, title: song.title };
  }
}

module.exports = { STATE_KEY, APP_URL, localDate, loadState, saveState, loadSongs, confOf, buildQueue,
  talkText, draftPost, composePost, fbCheck, fbPostVideo, runOnce };

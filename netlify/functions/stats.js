// /.netlify/functions/stats — anonymous usage counters for the band.
//   POST (open)  { did, events:[...] }          -> append a batch of events
//        events: {t:"visit", concert?, ref?, pwa?, fresh?}
//                {t:"listen", song, sec, plays}   (seconds actually heard)
//                {t:"concert", id}                (a saved concert was opened)
//                {t:"share", what}                (a Share button was used)
//                {t:"tab", tab}                   (a tab was opened)
//   GET  (band)  ?days=30  + x-upload-password  -> aggregated summary
//
// Nothing personal is stored: "did" is a random per-device id the app makes
// up, and even that is hashed before it lands here. Batches are written as
// small files under stats/raw/ (so simultaneous listeners never overwrite each
// other); the band's GET folds them into stats/summary.json and deletes them.
const { client, BUCKET, getJSON, putJSON, json } = require("./_r2");
const { ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");

const RAW_PREFIX = "stats/raw/";
const SUMMARY_KEY = "stats/summary.json";
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD;
const TZ = "America/New_York";

const clip = (s, n) => String(s == null ? "" : s).slice(0, n).trim();
const num = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
const hashDid = (did) => crypto.createHash("sha256").update("cac:" + did).digest("hex").slice(0, 16);
function localDate(ms) {
  // YYYY-MM-DD in the band's time zone, so a late-night listen counts for that evening.
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(ms));
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

const emptyDay = (date) => ({
  date, visits: 0, devices: [], newDevices: 0, pwa: 0, concertLinkVisits: 0,
  listenSec: 0, plays: 0, songs: {}, listeners: {}, concerts: {}, shares: 0, tabs: {},
});

function fold(day, did, ev) {
  if (!day.devices.includes(did)) day.devices.push(did);
  switch (ev.t) {
    case "visit":
      day.visits += 1;
      if (ev.fresh) day.newDevices += 1;
      if (ev.pwa) day.pwa += 1;
      if (ev.concert) day.concertLinkVisits += 1;
      break;
    case "listen": {
      const id = clip(ev.song, 80) || "other";
      const s = day.songs[id] || (day.songs[id] = { sec: 0, plays: 0 });
      s.sec += ev.sec; s.plays += ev.plays;
      day.listenSec += ev.sec; day.plays += ev.plays;
      const l = day.listeners[id] || (day.listeners[id] = []);
      if (!l.includes(did)) l.push(did);
      break;
    }
    case "concert": {
      const id = clip(ev.id, 80); if (!id) break;
      day.concerts[id] = (day.concerts[id] || 0) + 1;
      break;
    }
    case "share": day.shares += 1; break;
    case "tab": {
      const tab = clip(ev.tab, 30); if (!tab) break;
      day.tabs[tab] = (day.tabs[tab] || 0) + 1;
      break;
    }
  }
}

async function listRaw(max) {
  const keys = [];
  let token;
  do {
    const out = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: RAW_PREFIX, ContinuationToken: token, MaxKeys: 1000,
    }));
    for (const o of out.Contents || []) keys.push(o.Key);
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token && keys.length < max);
  return { keys: keys.slice(0, max), more: keys.length > max || !!token };
}

// Fold every pending raw batch into the summary, then delete the batches.
async function compact(summary) {
  const { keys, more } = await listRaw(1500);
  if (!keys.length) return { summary, folded: 0, more };
  const batches = [];
  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25);
    const got = await Promise.all(chunk.map((k) => getJSON(k, null).catch(() => null)));
    got.forEach((b, j) => { if (b) batches.push({ key: chunk[j], b }); });
  }
  for (const { b } of batches) {
    const did = clip(b.did, 32) || "anon";
    for (const ev of b.events || []) {
      const date = localDate(Number(ev.at) || Number(b.at) || Date.now());
      const day = summary.days[date] || (summary.days[date] = emptyDay(date));
      fold(day, did, ev);
    }
  }
  summary.updatedAt = new Date().toISOString();
  await putJSON(SUMMARY_KEY, summary);
  for (let i = 0; i < keys.length; i += 1000) {
    await client.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
    }));
  }
  return { summary, folded: batches.length, more };
}

function report(summary, daysBack) {
  const all = Object.values(summary.days).sort((a, b) => (a.date < b.date ? -1 : 1));
  const today = localDate(Date.now());
  const cutoff = daysBack ? localDate(Date.now() - (daysBack - 1) * 86400000) : "0000";
  const days = all.filter((d) => d.date >= cutoff && d.date <= today);
  const devices = new Set(), songs = {}, concerts = {}, tabs = {}, songListeners = {};
  const t = { visits: 0, newDevices: 0, pwa: 0, concertLinkVisits: 0, listenSec: 0, plays: 0, shares: 0, concertOpens: 0 };
  for (const d of days) {
    (d.devices || []).forEach((x) => devices.add(x));
    t.visits += d.visits; t.newDevices += d.newDevices; t.pwa += d.pwa || 0;
    t.concertLinkVisits += d.concertLinkVisits || 0;
    t.listenSec += d.listenSec; t.plays += d.plays; t.shares += d.shares;
    for (const [id, s] of Object.entries(d.songs || {})) {
      const a = songs[id] || (songs[id] = { id, sec: 0, plays: 0 });
      a.sec += s.sec; a.plays += s.plays;
      const set = songListeners[id] || (songListeners[id] = new Set());
      (d.listeners && d.listeners[id] || []).forEach((x) => set.add(x));
    }
    for (const [id, n] of Object.entries(d.concerts || {})) { concerts[id] = (concerts[id] || 0) + n; t.concertOpens += n; }
    for (const [k, n] of Object.entries(d.tabs || {})) tabs[k] = (tabs[k] || 0) + n;
  }
  const topSongs = Object.values(songs).map((s) => ({ ...s, sec: Math.round(s.sec), listeners: songListeners[s.id].size }))
    .sort((a, b) => b.sec - a.sec);
  const topConcerts = Object.entries(concerts).map(([id, n]) => ({ id, opens: n })).sort((a, b) => b.opens - a.opens);
  return {
    range: { daysBack: daysBack || null, from: days[0] ? days[0].date : null, to: today },
    totals: { ...t, listenSec: Math.round(t.listenSec), uniqueDevices: devices.size },
    days: days.map((d) => ({
      date: d.date, visits: d.visits, devices: (d.devices || []).length, newDevices: d.newDevices,
      listenSec: Math.round(d.listenSec), plays: d.plays, shares: d.shares,
      concertOpens: Object.values(d.concerts || {}).reduce((n, x) => n + x, 0),
    })),
    topSongs, topConcerts, tabs,
    firstDate: all[0] ? all[0].date : null,
    updatedAt: summary.updatedAt || null,
  };
}

exports.handler = async (event) => {
  // ---------- Open: record a batch ----------
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { error: "Bad JSON" }); }
    const did = clip(body.did, 40);
    const events = Array.isArray(body.events) ? body.events.slice(0, 200) : [];
    if (!did || !events.length) return json(400, { error: "Nothing to record" });
    const now = Date.now();
    const clean = events.map((ev) => {
      const t = clip(ev.t, 12);
      const at = num(ev.at, 8.64e15) || now;
      switch (t) {
        case "visit": return { t, at, concert: clip(ev.concert, 80), ref: clip(ev.ref, 80), pwa: !!ev.pwa, fresh: !!ev.fresh };
        case "listen": return { t, at, song: clip(ev.song, 80), sec: num(ev.sec, 4 * 3600), plays: Math.round(num(ev.plays, 500)) };
        case "concert": return { t, at, id: clip(ev.id, 80) };
        case "share": return { t, at, what: clip(ev.what, 40) };
        case "tab": return { t, at, tab: clip(ev.tab, 30) };
        default: return null;
      }
    }).filter(Boolean);
    if (!clean.length) return json(400, { error: "No usable events" });
    const key = `${RAW_PREFIX}${localDate(now)}/${now}-${crypto.randomBytes(4).toString("hex")}.json`;
    await putJSON(key, { did: hashDid(did), at: now, events: clean });
    return json(200, { ok: true, recorded: clean.length });
  }

  // ---------- Band: aggregated report ----------
  if (event.httpMethod === "GET") {
    const pw = event.headers["x-upload-password"] || event.headers["X-Upload-Password"];
    if (!UPLOAD_PASSWORD || pw !== UPLOAD_PASSWORD) return json(401, { error: "Band password required" });
    const daysBack = Math.round(num((event.queryStringParameters || {}).days, 3650));
    let summary = await getJSON(SUMMARY_KEY, { days: {} });
    if (!summary.days) summary.days = {};
    let folded = 0, more = false;
    try { ({ summary, folded, more } = await compact(summary)); }
    catch (err) { return json(500, { error: "Could not fold new events: " + err.message }); }
    return json(200, { ...report(summary, daysBack), folded, more });
  }

  return json(405, { error: "Method not allowed" });
};

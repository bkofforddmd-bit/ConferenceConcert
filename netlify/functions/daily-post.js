// Scheduled: runs every day at 13:00 UTC (8–9 AM Eastern, see netlify.toml)
// and posts the next song to the Facebook Page — if the band has switched
// daily posting on. Not reachable over HTTP; the band's panel is
// dailypost-admin.js.
const { runOnce } = require("./_dailypost");

exports.handler = async () => {
  const result = await runOnce();
  console.log("daily-post:", JSON.stringify(result));
  return { statusCode: 200, body: JSON.stringify(result) };
};

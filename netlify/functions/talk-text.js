// Netlify Function: talk-text.js
// Fetches a General Conference talk from churchofjesuschrist.org server-side
// (the browser can't — CORS blocks it) and returns the readable talk text.
// Used by the Prophet or Lyric? game. Only conference-talk URLs are allowed.

const ALLOWED_HOST = "www.churchofjesuschrist.org";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let url = null;
  try { url = JSON.parse(event.body).url; } catch (e) {}

  let parsed = null;
  try { parsed = new URL(url); } catch (e) {}
  if (!parsed || parsed.hostname !== ALLOWED_HOST ||
      !/general-conference/i.test(parsed.pathname)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Only churchofjesuschrist.org General Conference talk URLs are allowed." })
    };
  }

  try {
    const resp = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9"
      },
      redirect: "follow"
    });
    if (!resp.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: "Church site returned HTTP " + resp.status }) };
    }
    const html = await resp.text();

    // The talk body lives inside <article>. Fall back to the whole page.
    const artMatch = html.match(/<article[\s\S]*?<\/article>/i);
    let scope = artMatch ? artMatch[0] : html;
    scope = scope
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ")
      // footnote superscripts read as stray digits once tags are stripped
      .replace(/<sup[\s\S]*?<\/sup>/gi, " ")
      .replace(/<(h1|h2|h3|h4|h5|p|li|div|section|figcaption|blockquote|tr)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#8217;|&rsquo;/g, "’")
      .replace(/&#8216;|&lsquo;/g, "‘")
      .replace(/&#8220;|&ldquo;/g, "“")
      .replace(/&#8221;|&rdquo;/g, "”")
      .replace(/&#8212;|&mdash;/g, "—")
      .replace(/&#8211;|&ndash;/g, "–")
      .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

    const text = scope
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (text.length < 400) {
      return { statusCode: 502, body: JSON.stringify({ error: "Could not extract the talk text from the page." }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 60000) })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Fetch error: " + e.message }) };
  }
};

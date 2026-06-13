# Conference As A Concert — Song Library Setup

This is a one-time setup. After it's done, you and the band add songs from inside the app, and visitors can suggest talks. Budget about 20–30 minutes.

There are three pieces: a **GitHub repo** (the code), **Netlify** (hosts the site + runs the functions), and a **Cloudflare R2 bucket** (stores the MP3s and the catalog). The functions are the bridge between the app and R2.

---

## What's in this package

```
index.html                      ← the app (paste into GitHub root)
logo.png                        ← header logo (goes in repo root, next to index.html)
icon.png                        ← browser/app icon (repo root)
package.json                    ← tells Netlify to install the storage SDK
netlify.toml                    ← Netlify config
netlify/functions/
   _r2.js                       ← shared storage helper
   data.js                      ← loads catalog + suggestions (open)
   suggest.js                   ← saves a talk suggestion (open)
   concert.js                   ← saves/loads a visitor's concert (open)
   gdoc.js                      ← imports lyrics from a shared Google Doc (open)
   upload.js                    ← uploads an MP3 + adds the song (password)
```

Keep this folder structure exactly. The `netlify/functions/` path is where Netlify looks for functions.

---

## Step 1 — Put the code on GitHub

1. Create a new repository (or use a fresh one for this project — keep it separate from Seminary Tools).
2. Upload all the files **preserving the folders**. The easiest way: on your computer, drag this whole folder's contents into GitHub's "upload files" page — it keeps the `netlify/functions/` structure. (The repo root should contain `index.html`, `logo.png`, `icon.png`, `package.json`, `netlify.toml`, and the `netlify` folder.) The two PNGs must sit in the root next to `index.html` so the header logo and browser icon load.
3. Commit.

---

## Step 2 — Create the Cloudflare R2 bucket

1. Sign in at **dash.cloudflare.com** (free account is fine). In the left sidebar, open **R2**.
2. Click **Create bucket**. Name it something like `cac-songs`. Create it.
3. Open the bucket → **Settings** → find **Public access** (sometimes called "Public Development URL" / "R2.dev subdomain"). **Enable** it. Cloudflare gives you a public URL like:
   ```
   https://pub-abc123def456.r2.dev
   ```
   **Copy that URL** — this is your `R2_PUBLIC_BASE`. (This is what lets browsers stream the files.)

### Get your API keys

4. Back on the main **R2** page, click **Manage R2 API Tokens** (top right) → **Create API token**.
5. Permissions: **Object Read & Write**. Scope it to your bucket. Create.
6. Cloudflare shows you three things **once** — copy all three now:
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`
   - **Account ID** (also visible on the R2 overview page, right side) → `R2_ACCOUNT_ID`

---

## Step 3 — Deploy on Netlify

1. At **app.netlify.com**, click **Add new site → Import an existing project** and pick your GitHub repo.
2. Build settings: leave the build command **empty**, publish directory **`.`** (the `netlify.toml` already sets this). Deploy.
3. The first deploy installs the storage SDK automatically (from `package.json`). It may take a minute longer than a plain HTML site — that's normal.

### Add the environment variables

4. In the site: **Site configuration → Environment variables → Add a variable** (add each one):

   | Key | Value |
   |---|---|
   | `R2_ACCOUNT_ID` | your Cloudflare account ID |
   | `R2_ACCESS_KEY_ID` | the access key from step 2 |
   | `R2_SECRET_ACCESS_KEY` | the secret key from step 2 |
   | `R2_BUCKET` | `cac-songs` (your bucket name) |
   | `R2_PUBLIC_BASE` | the `https://pub-….r2.dev` URL |
   | `UPLOAD_PASSWORD` | `C0nferenceR0cks!` — the shared band password |

5. After adding them, **trigger a redeploy** (Deploys → Trigger deploy → Deploy site) so the functions pick up the variables.

---

## Step 4 — Try it

1. Open your Netlify site URL.
2. Go to the **Band Upload** tab, enter the band password (`C0nferenceR0cks!`), drag in an MP3, fill the talk details, and click **Add song to library**.
3. Switch to **Library** — the song should be there, streaming, with its source talk shown.
4. Open the **Suggest a Talk** tab in a private window (no password needed) and send a test suggestion.

---

## How the band uses it day to day

- **The band password is one shared password** (`C0nferenceR0cks!`) that everyone on the band enters — there are no individual accounts and nobody creates their own. Share it with whoever should be able to add songs. To change it later, just edit the `UPLOAD_PASSWORD` variable in Netlify and redeploy.
- **Add a song:** Band Upload tab → password (it's remembered for the session) → drop MP3 → fill details → add. Live for everyone immediately.
- **A song with only a video:** leave the MP3 out, paste a YouTube URL. The player shows the video.
- **A song with both:** add the MP3 *and* the YouTube URL — visitors get a Video / Audio-only toggle.
- **Preview start point:** in the upload form, "Preview start (seconds)" sets where the 20-second preview begins. Leave it at 0 for the intro, or set e.g. 45 to start the preview at the chorus. This is what visitors hear in the Concert Builder.
- **Length (for video-only songs):** MP3 lengths are detected automatically, so you can leave this blank for audio. For a song that's video-only (YouTube, no MP3), enter its length in seconds so the 2-hour concert meter stays accurate.
- **Lyrics:** paste the full lyrics into the "Lyrics" box on the upload form. They're shown in the app behind a "♪ Lyrics" toggle on the song card and in the concert builder rows. Line breaks are preserved. Leave it blank and no lyrics button appears.
- **Import lyrics from a Google Doc:** instead of pasting, drop a Google Doc share link into the "Import lyrics from a Google Doc" box and click Import. The fetched text appears in a **preview panel** — review it, then click "Use these lyrics" to drop it into the lyrics field (or Cancel to discard). Nothing fills the lyrics box until you confirm. **The Doc must be shared "Anyone with the link can view"** (open the Doc → Share → General access → Anyone with the link). Private Docs can't be read this way and will return a "not shared publicly" message. No Google sign-in or Drive connection is required — it uses Google's public plain-text export, so the `gdoc` function needs no keys or environment variables.

## How visitors build a concert

- The **Build a Concert** tab lets anyone preview songs (a 20-second clip from the band's chosen start point), add the ones they want, drag them into order with the up/down arrows, name the set, and **Save & get share link**.
- **Suggested arc:** visitors who want guidance can tap "Start from a suggested arc," which lays out five labeled sections — Opener, Build, Reflect, Peak, Closer — each with a hint, and they fill each section from the library. They can switch back to a free-form list anytime.
- **2-hour limit:** a running time meter shows the total against a 2-hour maximum. Song lengths are measured automatically from the MP3s; for video-only songs the band can enter a length in the upload form (otherwise a ~3.5-min estimate is used, marked "est."). Once the running total reaches 2 hours, adding more songs is blocked — but a song added while still under the limit is allowed to finish past it.
- Saving stores the concert in R2 and returns a link like `yoursite.netlify.app/?concert=ab12cd34`. Anyone who opens it gets a clean concert-player view that plays the set start to finish — audio advances automatically; for video songs the listener taps Next when the video ends (a browser autoplay rule, not a bug).
- Concerts reference songs by ID, so if the band later removes a song, it simply drops out of any saved concert rather than breaking it.

## Where suggestions go

Every visitor suggestion is saved to `suggestions.json` in your R2 bucket. Right now the band reads them by opening that file in the Cloudflare dashboard (R2 → your bucket → `suggestions.json`). If you'd like a **"Suggestions" tab inside the app** (password-gated, so the band can browse and mark them done without leaving the site), I can add it — just ask.

---

## Notes & limits

- **File size:** the uploader caps at 50 MB per file, which is plenty for a song. (R2's free tier covers ~10 GB of storage — hundreds of songs.)
- **Costs:** R2 has no egress fees, so streaming doesn't rack up bandwidth charges the way some hosts do. For a song library you'll almost certainly stay in the free tier.
- **Security:** the upload password gates *adding* songs. The library and suggestion form are public by design. Don't commit your keys to GitHub — they only ever live in Netlify's environment variables.
- **Backups:** because everything is in R2, your whole library is two files (`catalog.json` + the `audio/` folder) you can download anytime from Cloudflare.

---

## Common snags

- **"Wrong or missing password"** → the `UPLOAD_PASSWORD` env var isn't set, or you didn't redeploy after adding it.
- **Song added but won't play** → `R2_PUBLIC_BASE` is wrong, or the bucket's public access isn't enabled. Re-check Step 2.3.
- **Functions error / "Could not load library"** → one of the R2 keys is off, or `R2_BUCKET` doesn't match the real bucket name. Check the function logs in Netlify (Site → Functions → click a function → Logs).
- **Upload fails on a big file** → keep songs under 50 MB; export at a normal MP3 bitrate (e.g. 192–256 kbps).

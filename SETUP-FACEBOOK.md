# Daily Facebook posts — one-time setup

The app can post one song a day to a Facebook **Page** (Facebook does not let
software post to a personal profile). Once the three settings below are in
Netlify, the band's **Daily posts** tab does the rest.

What you need: a Facebook Page you manage, a free Meta developer account, an
Anthropic API key (the same kind the PMS uses). About 20 minutes.

## 1. A Page for the band

If you don't have one yet: facebook.com → Menu → **Pages** → **Create new
Page**. Name it "Conference as a Concert" (or whatever you like). You must be an
admin of this Page.

## 2. A Meta developer app

1. Go to https://developers.facebook.com → **My Apps** → **Create App**.
2. Pick **Other** → **Business** → name it "Conference as a Concert" → Create.
3. Leave the app in **Development** mode. That is fine: in development mode the
   app can post to Pages that *you* manage, which is all we need. (Going "Live"
   would require Meta's app review — not needed.)

## 3. The Page token (the part that actually matters)

1. Open the **Graph API Explorer**: https://developers.facebook.com/tools/explorer/
2. Top right, **Meta App**: choose the app from step 2.
3. **User or Page**: choose **Get Page Access Token**, pick your Page.
   When it asks for permissions, tick:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   (Posting a video to a Page is covered by `pages_manage_posts`; Meta does not
   offer `publish_video` for Pages, so do not look for it.)
   If the Explorer does not list a permission, add it to the app first:
   dashboard → Use cases → Customize "Manage everything on your Page" → Add.
   Continue and allow.
4. The **Access Token** box now holds a *Page* token. It expires in about an
   hour — we need the long-lived one:
   - Click the small **ⓘ** next to the token → **Open in Access Token Tool**.
   - At the bottom click **Extend Access Token**. Copy the extended token.
   - Page tokens obtained this way from a long-lived user token do not expire
     (the Access Token Tool will say "Expires: Never").
5. Your **Page ID**: in the Explorer, with the Page token selected, run
   `me?fields=id,name` (GET) and copy the `id`.

Keep the token private. Anyone holding it can post as your Page.

## 4. Put the settings into Netlify

Netlify → the site → **Site configuration** → **Environment variables** → add:

| Name | Value |
|---|---|
| `FB_PAGE_ID` | the Page id from step 3.5 |
| `FB_PAGE_TOKEN` | the extended Page token from step 3.4 |
| `ANTHROPIC_API_KEY` | an Anthropic API key (console.anthropic.com → API keys) |

Then **Deploys → Trigger deploy → Deploy site** so the functions pick them up.

## 5. Switch it on

In the app, unlock band mode and open the **Daily posts** tab:

- It shows whether Facebook is connected (your Page name appears) and whether
  the writer (Claude) is set up.
- **Next up** lists the next seven songs in posting order. Press **Write the
  draft** to see what will be said; edit the words if you like and **Save**.
  Anything you don't touch is written automatically on the morning it posts.
- **Post this one now** publishes immediately (useful as a first test).
- Flip **Daily posting** on. Every post goes out at **7:00 AM Eastern**: the next
  song in line each day while the switch is on, and any song you give a **Post
  on** date (that one posts on its date whether or not the switch is on). The
  Page link is saved on the song, so the Publish kit shows ✓.

## What gets posted

The video file (MP4) with a short caption: a sincere, plain-spoken note on
what the speaker said and why it matters today, then the link to the song in
the app and the link to the talk. Only songs that have a video are queued;
songs that are audio-only are left for the Publish kit.

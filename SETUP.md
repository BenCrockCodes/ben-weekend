# NEOVOLT — Production Setup Guide (benfun.cc + Supabase)

This guide takes the game from this folder to a live, multi-user site at
**https://benfun.cc** with accounts, profiles, cloud saves and wall
messages powered by Supabase.

The game is a fully static site (HTML/CSS/JS modules, no build step), so
"deployment" means uploading these files; all dynamic behaviour goes
through Supabase over HTTPS.

---

## Part 1 — Supabase setup

### 1.1 Create the project

1. Go to https://supabase.com and sign in (free tier is fine to launch).
2. **New project** → pick your organisation, name it `neovolt`,
   set a strong database password (store it in a password manager —
   the game never uses it), choose the region closest to your players.
3. Wait ~2 minutes for provisioning.

### 1.2 Create the database tables

1. In the dashboard open **SQL Editor → New query**.
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql)
   and click **Run**.
3. You should see "Success. No rows returned". The **Table Editor** now
   shows `profiles`, `stats`, `messages` and `levels`.

What the schema gives you:

- `profiles` — one row per account (username, icon), created automatically
  by a trigger the moment someone signs up.
- `stats` — each player's save data as JSON (cloud save).
- `messages` — wall messages between players.
- `levels` — ready for user-generated level uploads (future update).
- **Row Level Security on every table** — users can only write their own
  data; reading public things (profiles, walls, published levels) is open.
  This is what makes it safe to ship the API key in the browser.

### 1.3 Configure authentication

1. **Authentication → Sign In / Up → Email**: make sure the Email provider
   is **enabled** (it is by default).
2. *Optional but recommended for launch:* under **Confirm email**, decide
   whether players must click a confirmation link. Leaving it ON is safer
   against spam accounts; turning it OFF lets people play instantly.
3. **Authentication → URL Configuration**:
   - **Site URL**: `https://benfun.cc`
   - **Redirect URLs**: add `https://benfun.cc` (and
     `http://localhost:5173` while you're still testing locally).
   This makes email confirmation links land back on your site.

### 1.4 Verify the security policies

1. Open **Advisors → Security Advisor** in the dashboard and run it.
   It should report no errors for the four game tables (RLS is enabled
   with owner-scoped policies by the schema file).
2. Spot-check in **Authentication → Policies**: every table listed above
   should show RLS **enabled** with the policies from the schema.

### 1.5 Connect the game

1. Dashboard → **Project Settings → Data API**: copy the **Project URL**
   (looks like `https://abcdefgh.supabase.co`).
2. **Project Settings → API Keys**: copy the **publishable** key
   (`sb_publishable_...`; on older projects this is the `anon` key).
3. Open [`js/backend/backendConfig.js`](js/backend/backendConfig.js) and
   paste both values:

```js
export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_xxxxxxxxxxxx';
```

> **Key safety:** the publishable/anon key is *designed* to be public —
> every Supabase site ships it to browsers, and Row Level Security decides
> what it can touch. The **service_role / secret key must never appear
> anywhere in this project** — it bypasses all security.

4. Test locally: `npx serve .` → http://localhost:5173 → the gold
   **SIGN IN** chip on the main menu now opens working account forms.

---

## Part 2 — Deploying to benfun.cc

The game is static files — any web host works. Two common setups:

### Option A — classic web hosting (cPanel / FTP)

1. Upload the following to the domain's web root (usually `public_html/`),
   **keeping the folder structure intact**:

```
index.html
style.css
editor.css
js/            (entire folder, including js/backend/ and js/editor/)
shaders/
assets/
```

   You do NOT need to upload: `tools/`, `supabase/`, `README.md`,
   `SETUP.md`, `.claude/`, `.idea/` (they're development files — though
   uploading them does no harm).

2. Make sure the host serves `.js` files with the
   `text/javascript` MIME type (all mainstream hosts do) — ES modules
   refuse to run otherwise.
3. Enable **HTTPS** for benfun.cc (usually one click — Let's Encrypt).
   HTTPS is required: browsers block secure Supabase calls from insecure
   pages, and audio autoplay policies are stricter on http.

### Option B — Cloudflare Pages / Netlify / Vercel (recommended)

1. Push this folder to a Git repository (or drag-and-drop the folder in
   the provider's dashboard).
2. Framework preset: **None** — no build command, publish directory = the
   project root.
3. Add the custom domain **benfun.cc** in the provider's dashboard and
   point the domain's DNS (CNAME/A records) at it as instructed.
   HTTPS certificates are automatic.

### Why Supabase "just works" from the domain

The Supabase Data API accepts requests from any origin (RLS + keys are the
security model, not CORS), so no server configuration is needed on
benfun.cc. The only origin-sensitive part is **auth email links**, which
you already pointed at `https://benfun.cc` in step 1.3.

### Performance notes (already handled in the code)

- Zero binary assets: the whole game is ~120 KB of code; levels are an
  internal module (no fetches at boot).
- supabase-js loads lazily from a pinned CDN build **only when the backend
  is configured** — offline builds never pay for it.
- Google Fonts are the only other external resource and degrade to system
  fonts if blocked.
- Works in Chrome, Edge, Firefox and Safari, and on mobile (landscape) —
  the UI is responsive and touch controls are built in.

---

## Part 3 — Testing checklist

Run through this on **https://benfun.cc** after deploying (each item maps
to a launch requirement):

- [ ] **Game loads over HTTPS** — no mixed-content or module MIME errors
      in the browser console (F12).
- [ ] **Account creation works** — menu → SIGN IN chip → CREATE ACCOUNT.
      A `profiles` row and a `stats` row appear in the Supabase Table
      Editor (created by the signup trigger).
- [ ] **Email confirmation** (if enabled) — the link in the email returns
      to benfun.cc and signing in afterwards works.
- [ ] **Login works** — sign out, sign back in; the chip shows your
      username.
- [ ] **Profiles load correctly** — your username, icon and stats appear;
      changing the profile icon persists after a refresh.
- [ ] **Cloud saves merge** — complete a level, refresh, sign in from a
      second browser: progress appears there too (best % / attempts are
      merged, never lost).
- [ ] **Messages save correctly** — post on your wall; the row appears in
      the `messages` table; deleting it works.
- [ ] **Multiple users can view profiles** — from a second account, search
      the first account's username: profile, stats and wall are visible,
      and posting on their wall works.
- [ ] **Database permissions are correct** — while signed out you can
      *view* profiles/walls but any write fails; in the SQL editor,
      `select * from auth.users` style data is never exposed through the
      API; the Security Advisor shows no RLS errors.
- [ ] **The game itself works from benfun.cc** — all five main levels,
      editor, custom levels and audio behave exactly as they did locally.

---

## Architecture recap (for future features)

```
Frontend (static files on benfun.cc)
   js/backend/backend.js      ← the ONLY file that talks to Supabase
        │  (HTTPS + publishable key; RLS enforces permissions)
Supabase
   ├── Authentication         email/password accounts
   ├── profiles               usernames + icons          (live)
   ├── stats                  cloud saves                (live)
   ├── messages               profile walls              (live)
   ├── levels                 UGC uploads/downloads      (table + API ready, UI future)
   └── future                 comments, ratings, global leaderboards,
                              achievements, friends — add tables + RLS in
                              schema.sql and a service block in backend.js
```

Adding a future feature never requires a rewrite: create the table + RLS
policies in `supabase/schema.sql`, add a service section to
`js/backend/backend.js`, and build UI on top.

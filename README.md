# Time Tracker + Pomodoro

A personal time-tracking + Pomodoro webapp that syncs across devices and runs on GitHub Pages.

## Features

- **Task tracking** — Create tasks and track time spent on each
- **Daily total** — Running tally of all time tracked today (resets by date)
- **Pomodoro timer** — Work in focused periods with breaks; configurable focus/break durations
- **Repetitions (sets)** — Optionally cap a session to a set number of focus periods, then it stops automatically (0 = run until you stop it)
- **Alarms** — Choose Beep, Chime, Bell, Screen Flash, or **Flash + Beep** when each period ends
- **Background alerts** — The timer keeps running in a background tab (Web Worker), and a system notification fires when a period ends even if you're in another app (grant notification permission when prompted). Note: a browser can't flash your screen or beep from a backgrounded tab — the in-page flash/sound play when the tab is visible; system notifications cover the rest
- **Continuous timeline blocks** — Uninterrupted focus on one category shows as a single continuous block (consecutive periods are merged; breaks absorbed) instead of fragmented chunks
- **Cross-device sync** — Data syncs in real time across laptop and phone via Supabase (note: the repetitions setting is local to each device)
- **Email + password sign-in** — Create an account and sign in with email + password (no magic links, codes, or email round-trips). Requires "Confirm email" to be turned OFF in Supabase → Authentication → Providers → Email so sign-up logs you in instantly
- **Mobile-friendly** — Responsive design; use "Add to Home Screen" to make it feel like an app
- **Delete time entries** — Click any block in the timeline to select it (white ring appears), then press Delete or Backspace to remove it
- **Offline support** — Service worker caches the app; works offline and syncs when you come back online
- **Web app manifest** — Install on home screen; full-screen standalone mode

## Getting started

### Local development

1. Clone this repo
2. Copy `config.example.js` to `config.js` (optional for now; required for Supabase sync later)
3. Serve locally: `/dev` (or `python3 -m http.server 8000`)
4. Open `http://localhost:8000` in your browser

### Building

See `CLAUDE.md` for the build milestones and architecture notes.

### Installing as a Web App ("Add to Home Screen")

The app is fully installable on both desktop and mobile devices:

**On Android (Chrome):**
1. Open the app URL in Chrome
2. Tap the menu (three dots) → "Install app" or look for the install banner at the bottom
3. Confirm to add it to your home screen

**On iPhone (Safari):**
1. Open the app URL in Safari
2. Tap the Share button (box with arrow)
3. Select "Add to Home Screen"
4. Choose a name and tap "Add"

**On Mac/Windows (Chrome/Edge):**
1. Open the app URL in your browser
2. Click the install icon (usually in the address bar or menu)
3. Confirm to install

Once installed, the app runs in full-screen mode with offline support.

### Deploying to GitHub Pages

1. Push the repo to GitHub
2. Go to the repo settings → Pages
3. Set Source to "Deploy from a branch" and select `main` / root folder
4. The app will be live at `https://username.github.io/work_tracking`
5. On any device, visit the URL and use "Add to Home Screen" (see above)

### Configuring Supabase (for cross-device sync)

1. Set up a Supabase project (or use an existing one)
2. Create tables: `tasks`, `time_entries`, `settings` with the schema defined in CLAUDE.md
3. Enable Row-Level Security (RLS) and set up auth
4. Copy your Supabase URL and anon key into `config.js`
5. See CLAUDE.md for detailed Supabase setup

## Development

- **`/dev`** — Start a local dev server
- **`/verify`** — Manual browser verification checklist
- See CLAUDE.md for architecture details and the storage wrapper pattern

## Tech stack

- **Frontend:** vanilla HTML / CSS / JavaScript (no build step)
- **Hosting:** GitHub Pages
- **Cloud sync:** Supabase (Postgres + real-time + auth)
- **Storage:** localStorage (offline cache) + Supabase (cloud)

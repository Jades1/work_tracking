# Time Tracker + Pomodoro

A personal time-tracking + Pomodoro webapp that syncs across devices and runs on GitHub Pages.

## Features

- **Task tracking** — Create tasks and track time spent on each
- **Daily total** — Running tally of all time tracked today (resets by date)
- **Pomodoro timer** — Work in focused 30-minute periods with 5-minute breaks; configurable durations
- **Alarm sound** — Audio notification when each Pomodoro period ends
- **Cross-device sync** — Data syncs in real time across laptop and phone via Supabase
- **Mobile-friendly** — Responsive design; use "Add to Home Screen" to make it feel like an app
- **Offline support** — localStorage keeps the app working offline; changes sync when you come back online

## Getting started

### Local development

1. Clone this repo
2. Copy `config.example.js` to `config.js` (optional for now; required for Supabase sync later)
3. Serve locally: `/dev` (or `python3 -m http.server 8000`)
4. Open `http://localhost:8000` in your browser

### Building

See `CLAUDE.md` for the build milestones and architecture notes.

### Deploying to GitHub Pages

1. Push the repo to GitHub
2. Go to the repo settings → Pages
3. Set Source to "Deploy from a branch" and select `main` / root folder
4. The app will be live at `https://username.github.io/work_tracking`
5. On mobile, open the URL and tap "Add to Home Screen" to install as an app

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

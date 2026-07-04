# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A personal time-tracking + Pomodoro webapp (vanilla HTML/CSS/JS, no build step) that syncs across devices via Supabase and is hosted free on GitHub Pages.

## Architecture

### Storage wrapper pattern
All data access goes through `storage.js`, which provides a unified interface for `localStorage` (offline/instant cache) and Supabase (cloud sync). This allows:
- Immediate UI updates via localStorage
- Background sync to Supabase without rewriting the app logic
- Works offline and online seamlessly

### Config file conventions
- `config.js` — Supabase project URL + anon key (gitignored, never committed)
- `config.example.js` — Template file; users copy to config.js and fill in their credentials

### Data model (per user, synced to Supabase)
- `tasks` (a "task" is a category in the UI): { id, name, color, createdAt, deleted } — soft-deleted via the `deleted` flag so deletions propagate across devices. IDs are `crypto.randomUUID()` (collision-safe).
- `time_entries`: { id, taskId, start, end, durationSec, type: "tracked" | "pomodoro-work" }
- `settings`: { workMinutes, breakMinutes, alarmSound } (+ local-only `repetitions`, not synced)

Daily totals are computed by summing time_entries for the current **local** date.

While a focus session runs, the active work segment is saved as a single live
`time_entry` that is extended (`updateTimeEntry`) every ~15s and finalized at the
period boundary or on Stop — so in-progress time is visible and durable, not lost
if the tab closes mid-period.

## File structure

- `index.html` — markup + layout
- `styles.css` — styling, mobile-responsive
- `app.js` — UI logic, timers, Pomodoro state machine
- `storage.js` — storage wrapper (localStorage + Supabase behind one interface)
- `config.js` — Supabase credentials (gitignored)
- `config.example.js` — template for config.js
- `README.md` — setup + GitHub Pages deployment
- `.gitignore` — excludes config.js

## Supabase setup

- Reuse existing Supabase account; create a new project or new tables in the existing project
- Enable Row-Level Security (RLS) so each user sees only their own data
- Use Supabase Auth (email magic-link or Google) for sign-in; load `@supabase/supabase-js` via CDN (no build step)

## Verification approach

Manual browser testing per the plan:
1. Create tasks, start/stop time tracking, verify daily total sums and rolls over by date
2. Pomodoro: run a 30-min work + break cycle, confirm alarm fires, verify settings change durations
3. Sync: change data on one device, confirm it appears on others in real time
4. GitHub Pages: load the deployed URL on laptop and phone

## GitHub Pages deployment

The repo itself is the source; enable GitHub Pages in the repo settings (Source: main branch, folder: root). Push to main to deploy. Phone: open the GitHub Pages URL and use "Add to Home Screen" to make it feel like an installed app.

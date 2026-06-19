---
name: dev
description: Start a local development server to test the app in a browser
---

## Purpose

Serve the app locally on a dev server so you can test it during development. Since this is vanilla HTML/CSS/JS with no build step, this is a simple HTTP server.

## How to use

Run `/dev` to start a local server. The app will be available at `http://localhost:8000` (or the next available port if 8000 is in use).

## Implementation

- Start a Python HTTP server: `python3 -m http.server 8000` (or `python -m http.server 8000` on Windows)
- Alternatively, use `npx http-server` if Node is available
- Open `http://localhost:8000` in a browser
- Keep the server running in the background; reload the page to see changes

## Notes

- No build step needed; changes to `.html`, `.css`, `.js` are live on reload
- For testing Supabase sync, you'll need `config.js` filled in with real credentials (copy from `config.example.js`)
- localStorage works without any special setup

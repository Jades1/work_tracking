# Supabase Setup Guide

This guide walks you through setting up Supabase for cross-device sync on the Time Tracker app.

## Prerequisites

- Existing Supabase account at https://supabase.com
- The app credentials in `config.js` (already filled in)

## Step 1: Create the Database Tables

1. Go to your Supabase dashboard: https://supabase.com/dashboard
2. Select your project (`qpzydwdgreunlskqsxhy`)
3. Go to **SQL Editor** (left sidebar)
4. Click **New Query**
5. Copy the entire contents of `supabase-setup.sql` from this folder
6. Paste it into the query editor
7. Click **Run** to execute
8. You should see success messages for each table, index, and policy

**What this creates:**
- `tasks` table: stores task name and creation date
- `time_entries` table: stores all tracked time with start/end times
- `settings` table: stores user preferences (work/break duration, alarm sound)
- Row-Level Security (RLS) policies so each user only sees their own data
- Indexes for fast queries

## Step 2: Enable Google OAuth

1. In Supabase dashboard, go to **Authentication** → **Providers**
2. Find **Google** and click it
3. Toggle it **On**
4. You'll need Google OAuth credentials:
   - Go to https://console.cloud.google.com
   - Create a new project or use an existing one
   - Enable the **Google+ API**
   - Go to **Credentials** → **Create OAuth 2.0 Credentials** → **Desktop app** (or choose what fits)
   - Copy the **Client ID** and **Client Secret**
5. Back in Supabase, paste those into the Google provider form
6. Add your redirect URLs:
   - `http://localhost:8000` (for local development)
   - `https://yourusername.github.io/work_tracking` (for GitHub Pages deployment)
7. **Save**

## Step 3: Test the Setup

1. **Local testing:**
   - Make sure the dev server is running: `/dev` (or `python3 -m http.server 8000`)
   - Open http://localhost:8000
   - Click "Sign in with Google"
   - You should be redirected to Google login, then back to the app
   - Check that your email appears in the header after signing in

2. **Create a test task:**
   - After signing in, create a task and track some time
   - Check the Supabase dashboard:
     - Go to **Table Editor** → `tasks` → you should see your task
     - Go to **Table Editor** → `time_entries` → you should see the tracked time

3. **Test cross-device sync:**
   - Open the app in two browser tabs (or on two devices if you've deployed)
   - Create a task in one tab
   - The task should appear in the other tab within a few seconds (realtime subscription)

## Troubleshooting

**"Sign in with Google" button doesn't work:**
- Check browser console (F12 → Console tab) for errors
- Make sure `config.js` has the correct Supabase URL and key
- Make sure Google OAuth is enabled in Supabase

**Can't see my tasks after signing in:**
- Refresh the page (Cmd+R)
- Check Supabase Table Editor to see if the data is there
- Check browser console for errors in the Network tab

**RLS errors in console:**
- Make sure you ran the full `supabase-setup.sql` script
- Check that the RLS policies are present in **Authentication** → **Policies**

**Data not syncing across devices:**
- Both devices must be signed in with the same Google account
- Check browser console for sync errors
- Realtime subscriptions may take a few seconds; refresh if needed

## What's happening under the hood

- **localStorage** stores a cache of your data locally (works offline)
- **Supabase** stores the official copy in the cloud
- When you create/update data, it saves to localStorage immediately, then syncs to Supabase in the background
- Real-time subscriptions listen for changes on other devices and pull them in automatically
- RLS policies ensure you can only see your own data, even though the app uses an anonymous API key

## Next Steps

- **GitHub Pages deployment:** See `README.md` for deployment instructions
- **Custom branding:** Edit the app name and colors in `manifest.json` and `styles.css`
- **Backup:** Export your data via the browser's Developer Tools (Local Storage) or query Supabase directly

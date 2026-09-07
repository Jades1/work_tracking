# TODO

- [ ] **Add "Change password" feature** — let the signed-in user set a new password
  from within the app (`supabase.auth.updateUser({ password })`), with a small form
  in the header/settings. Needed because there's currently no in-app way to rotate a
  password. (The password set during initial setup should be rotated.)

- [ ] **[J] Add the missing `color` column to the live Time Tracker project** (2026-09-06).
  The cloud `tasks` table was created without it, which silently blocked ALL sync from
  Jul 2 to Sep 6 (every category upsert rejected, every entry then failed its foreign
  key). The app now syncs without the column, but category colors stay per-device until
  it exists. One line in the dashboard SQL Editor (or via the Management API, see
  `../SUPABASE_NOTES.md`):
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#2563eb';`
- [ ] **One orphaned entry not in the cloud**: a 12-minute block on 2026-07-04 whose
  category id (`1783193645308`, pre-UUID) no longer exists. It lives only in
  `backups/workTrackerData-2026-09-06-safari.json` (gitignored). Re-attach to a category
  or drop it.

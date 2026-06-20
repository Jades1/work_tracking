# TODO

- [ ] **Add "Change password" feature** — let the signed-in user set a new password
  from within the app (`supabase.auth.updateUser({ password })`), with a small form
  in the header/settings. Needed because there's currently no in-app way to rotate a
  password. (The password set during initial setup should be rotated.)

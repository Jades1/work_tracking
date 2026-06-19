---
name: verify
description: Manual browser verification checklist for the app
---

## Purpose

Test the app in a browser following the plan's verification steps. Use this after implementing a milestone to confirm it works as expected.

## Verification checklist

### Task list + time tracking
- [ ] Create a task
- [ ] Start tracking time on the task (stopwatch mode)
- [ ] Stop tracking
- [ ] Verify elapsed time is logged
- [ ] Create a second task and verify both tasks appear in the list
- [ ] Verify daily total sums correctly
- [ ] Check that the daily total resets/rolls over by date

### Pomodoro timer
- [ ] Start a Pomodoro session (default 30 min work)
- [ ] Watch the countdown (you can speed this up by shortening the duration in settings temporarily)
- [ ] Verify the alarm sound plays when the work period ends
- [ ] Verify the timer switches to break mode (default 5 min)
- [ ] Verify the alarm plays again when the break ends
- [ ] Change settings (work/break minutes) and verify the durations update

### Mobile responsiveness
- [ ] Test on a laptop/desktop browser
- [ ] Test on a phone (or browser dev tools mobile view)
- [ ] Verify the layout adapts and is usable on both

### Cross-device sync (if Supabase is set up)
- [ ] On device A (laptop), create a task
- [ ] On device B (phone or another browser tab), refresh and verify the task appears
- [ ] On device B, start tracking time
- [ ] On device A, refresh and verify the time entry appears in real time

### GitHub Pages deployment
- [ ] Push to main branch
- [ ] Verify GitHub Pages is enabled in repo settings
- [ ] Load the GitHub Pages URL on laptop
- [ ] Load the GitHub Pages URL on phone
- [ ] Verify the app works the same as the local dev server

## Running the verification

1. Start the dev server with `/dev`
2. Open `http://localhost:8000` in a browser
3. Work through the checklist above
4. If Supabase is integrated, test on two devices/tabs simultaneously for sync
5. When ready to deploy, verify on the live GitHub Pages URL

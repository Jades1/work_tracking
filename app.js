// UI Logic and state management

class App {
    constructor() {
        // Color palette for categories (blue-forward, distinct hues)
        this.PALETTE = [
            '#2563eb', // blue
            '#0ea5e9', // sky
            '#06b6d4', // cyan
            '#10b981', // emerald
            '#84cc16', // lime
            '#f59e0b', // amber
            '#f43f5e', // rose
            '#8b5cf6'  // violet
        ];
        this.selectedColor = this.nextUnusedColor();

        // Active focus session state
        this.activeCategoryId = null;
        this.selectedEntryId = null;
        this.timelineMode = 'today';
        this.sessionRunning = false;
        this.sessionMode = 'work'; // 'work' or 'break'
        this.sessionEndTime = null;
        this.sessionIntervalId = null;
        this.workSegmentStart = null;
        this.workPeriodsCompleted = 0; // completed focus periods in the current session
        this.timerWorker = null; // Web Worker that drives ticks (background-resilient)

        // Shared audio context for alarms (created/resumed on a user gesture)
        this.audioCtx = null;

        // Offline mode: lets the user use the app locally without signing in
        this.OFFLINE_KEY = 'workTrackerOfflineMode';

        this.user = null;

        this.initEventListeners();
        this.renderColorPalette();
        this.checkAuthState();
    }

    checkAuthState() {
        this.user = storage.getUser();
        if (this.user) {
            this.showApp();
        } else if (localStorage.getItem(this.OFFLINE_KEY) === 'true') {
            this.showApp();
        } else {
            this.showAuthModal();
        }
    }

    onAuthChange(user) {
        this.user = user;
        if (user) {
            // A real session takes over from offline mode
            localStorage.removeItem(this.OFFLINE_KEY);
            this.showApp();
        } else {
            this.showAuthModal();
        }
    }

    continueOffline() {
        localStorage.setItem(this.OFFLINE_KEY, 'true');
        this.showApp();
    }

    showAuthModal() {
        document.getElementById('authModal').style.display = 'flex';
        document.querySelector('.container').style.display = 'none';
        this.renderCategoryList();
        this.updateDailyTotal();
    }

    showApp() {
        document.getElementById('authModal').style.display = 'none';
        document.querySelector('.container').style.display = 'block';
        this.updateAuthStatus();
        this.renderColorPalette();
        this.renderCategoryList();
        this.updateDailyTotal();
    }

    updateAuthStatus() {
        const userEmail = document.getElementById('userEmail');
        const signOutBtn = document.getElementById('signOutBtn');
        const headerSignInBtn = document.getElementById('headerSignInBtn');

        if (this.user) {
            userEmail.textContent = this.user.email;
            signOutBtn.style.display = 'inline-block';
            headerSignInBtn.style.display = 'none';
        } else {
            userEmail.textContent = 'Offline';
            signOutBtn.style.display = 'none';
            headerSignInBtn.style.display = 'inline-block';
        }
    }

    initEventListeners() {
        // Auth
        document.getElementById('signInBtn').addEventListener('click', () => this.signInWithPassword());
        document.getElementById('signUpBtn').addEventListener('click', () => this.signUpWithPassword());
        document.getElementById('authPassword').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.signInWithPassword();
        });
        document.getElementById('signOutBtn').addEventListener('click', () => this.signOut());
        document.getElementById('offlineBtn').addEventListener('click', () => this.continueOffline());
        document.getElementById('headerSignInBtn').addEventListener('click', () => {
            this.showAuthForm();
            this.showAuthModal();
        });

        // Category input
        document.getElementById('addCategoryBtn').addEventListener('click', () => this.addCategory());
        document.getElementById('categoryInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addCategory();
        });

        // Settings
        document.getElementById('workMinutes').addEventListener('change', (e) => {
            storage.updateSettings({ workMinutes: parseInt(e.target.value) });
        });
        document.getElementById('breakMinutes').addEventListener('change', (e) => {
            storage.updateSettings({ breakMinutes: parseInt(e.target.value) });
        });
        document.getElementById('repetitions').addEventListener('change', (e) => {
            const v = parseInt(e.target.value);
            storage.updateSettings({ repetitions: isNaN(v) || v < 0 ? 0 : v });
        });

        // Alarm selection
        const alarmSelect = document.getElementById('alarmSound');
        alarmSelect.addEventListener('change', (e) => {
            storage.updateSettings({ alarmSound: e.target.value });
        });
        document.getElementById('testAlarmBtn').addEventListener('click', () => {
            this.getAudioContext(); // unlock/resume audio on this user gesture
            this.playAlarm();
        });

        // Delete selected time entry on Delete/Backspace
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Delete' && e.key !== 'Backspace') return;
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (!this.selectedEntryId) return;
            // A timeline block may represent several merged entries (comma-joined ids)
            this.selectedEntryId.split(',').forEach(id => storage.deleteTimeEntry(id));
            this.selectedEntryId = null;
            this.updateTimelineHint(false);
            this.updateDailyTotal();
        });

        // Delegated click handler on the static #timeline container — persists through innerHTML re-renders
        const timelineEl = document.getElementById('timeline');
        timelineEl.addEventListener('click', (e) => {
            const block = e.target.closest('.timeline-block');
            e.stopPropagation();
            if (!block) {
                if (this.selectedEntryId) {
                    this.selectedEntryId = null;
                    timelineEl.querySelectorAll('.timeline-block.selected').forEach(b => b.classList.remove('selected'));
                    this.updateTimelineHint(false);
                }
                return;
            }
            const id = block.dataset.entryId;
            const alreadySelected = this.selectedEntryId === id;
            timelineEl.querySelectorAll('.timeline-block').forEach(b => b.classList.remove('selected'));
            if (!alreadySelected) {
                this.selectedEntryId = id;
                block.classList.add('selected');
                this.updateTimelineHint(true);
            } else {
                this.selectedEntryId = null;
                this.updateTimelineHint(false);
            }
        });

        // Deselect when clicking outside the timeline entirely
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#timeline') && this.selectedEntryId) {
                this.selectedEntryId = null;
                document.querySelectorAll('.timeline-block.selected').forEach(b => b.classList.remove('selected'));
                this.updateTimelineHint(false);
            }
        });

        // Timeline mode tabs
        document.querySelectorAll('.timeline-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.timeline-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.timelineMode = btn.dataset.mode;
                this.selectedEntryId = null;
                this.updateTimelineHint(false);
                this.renderTimeline();
            });
        });

        // Resume the (often auto-suspended) audio context when returning to the tab
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) this.getAudioContext();
        });

        // Initialize settings UI
        const settings = storage.getSettings();
        document.getElementById('workMinutes').value = settings.workMinutes;
        document.getElementById('breakMinutes').value = settings.breakMinutes;
        document.getElementById('repetitions').value = settings.repetitions ?? 0;
        alarmSelect.value = this.getAlarmChoice();
    }

    async signInWithPassword() {
        const email = document.getElementById('authEmail').value.trim();
        const password = document.getElementById('authPassword').value;
        if (!email || !password) {
            this.showAuthError('Enter your email and password.');
            return;
        }

        const btn = document.getElementById('signInBtn');
        btn.disabled = true;
        btn.textContent = 'Signing in...';
        try {
            await storage.signInWithPassword(email, password);
            // onAuthChange() swaps to the signed-in app view.
        } catch (e) {
            console.error('Sign in failed:', e);
            let msg = e.message || 'Sign in failed.';
            if (/invalid login credentials/i.test(msg)) {
                msg = 'Wrong email or password. New here? Tap "Create Account".';
            }
            this.showAuthError(msg);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Sign In';
        }
    }

    async signUpWithPassword() {
        const email = document.getElementById('authEmail').value.trim();
        const password = document.getElementById('authPassword').value;
        if (!email) {
            this.showAuthError('Enter your email.');
            return;
        }
        if (password.length < 6) {
            this.showAuthError('Password must be at least 6 characters.');
            return;
        }

        const btn = document.getElementById('signUpBtn');
        btn.disabled = true;
        btn.textContent = 'Creating...';
        try {
            const data = await storage.signUpWithPassword(email, password);
            if (data && data.session) {
                // Signed in immediately (email confirmation disabled in Supabase).
                // onAuthChange() handles the view swap.
            } else {
                // No session => Supabase still has "Confirm email" enabled.
                this.showAuthError(
                    'Account created. Turn OFF "Confirm email" in Supabase ' +
                    '(Authentication → Providers → Email), then tap Sign In.'
                );
            }
        } catch (e) {
            console.error('Sign up failed:', e);
            let msg = e.message || 'Could not create account.';
            if (/already registered/i.test(msg)) {
                msg = 'That email already has an account — tap Sign In instead.';
            }
            this.showAuthError(msg);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Create Account';
        }
    }

    showAuthError(message) {
        const el = document.getElementById('authError');
        el.textContent = message;
        el.style.display = 'block';
    }

    showAuthForm() {
        document.getElementById('authForm').style.display = 'block';
        document.getElementById('authError').style.display = 'none';
        document.getElementById('signInBtn').disabled = false;
        document.getElementById('signInBtn').textContent = 'Sign In';
    }

    async signOut() {
        if (confirm('Sign out? You will lose access to cloud sync.')) {
            await storage.signOut();
        }
    }

    // Category color helpers
    nextUnusedColor() {
        const used = storage.getTasks().map(c => c.color);
        const unused = this.PALETTE.find(c => !used.includes(c));
        return unused || this.PALETTE[storage.getTasks().length % this.PALETTE.length];
    }

    renderColorPalette() {
        const palette = document.getElementById('colorPalette');
        if (!palette) return;
        palette.innerHTML = this.PALETTE.map(c => `
            <button
                type="button"
                class="swatch ${c === this.selectedColor ? 'selected' : ''}"
                data-color="${c}"
                style="background:${c}"
                title="${c}"
            ></button>
        `).join('');

        palette.querySelectorAll('.swatch').forEach(sw => {
            sw.addEventListener('click', () => {
                this.selectedColor = sw.dataset.color;
                this.renderColorPalette();
            });
        });
    }

    // Category Management
    addCategory() {
        const input = document.getElementById('categoryInput');
        const name = input.value.trim();
        if (!name) return;

        storage.addTask(name, this.selectedColor);
        input.value = '';
        this.selectedColor = this.nextUnusedColor();
        this.renderColorPalette();
        this.renderCategoryList();
    }

    deleteCategory(id) {
        if (confirm('Delete this category? Its logged time will also be removed.')) {
            if (this.activeCategoryId === id) {
                this.stopSession();
            }
            storage.deleteTask(id);
            this.renderCategoryList();
            this.updateDailyTotal();
        }
    }

    renderCategoryList() {
        const list = document.getElementById('categoryList');
        const categories = storage.getTasks();

        if (categories.length === 0) {
            list.innerHTML = '<li class="category-empty">No categories yet. Add one to start tracking.</li>';
        } else {
            list.innerHTML = categories.map(cat => {
                const totalSec = storage.getTotalTimeForTaskOnDate(cat.id);
                const timeStr = this.formatSeconds(totalSec);
                const isActive = cat.id === this.activeCategoryId;

                return `
                    <li class="category-item ${isActive ? 'active' : ''}" data-id="${cat.id}" style="border-left-color:${cat.color}">
                        <div class="category-item-left">
                            <span class="category-dot" style="background:${cat.color}"></span>
                            <span class="category-name">${this.escapeHtml(cat.name)}</span>
                            <span class="category-time">Today: ${timeStr}</span>
                        </div>
                        <div class="category-item-actions">
                            ${isActive ? '<span class="category-running">● running</span>' : ''}
                            <button class="btn-danger" onclick="app.deleteCategory('${cat.id}')">Delete</button>
                        </div>
                    </li>
                `;
            }).join('');

            // Clicking a category starts (or switches to) its focus session
            list.querySelectorAll('.category-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (!e.target.closest('button')) {
                        this.onCategoryClick(item.dataset.id);
                    }
                });
            });
        }

        // Keep the timeline in sync
        this.renderTimeline();
    }

    updateTimelineHint(selected) {
        const hint = document.getElementById('timelineHint');
        if (!hint) return;
        if (selected) {
            hint.textContent = 'Entry selected — press Delete or Backspace to remove';
            hint.classList.add('active');
        } else {
            hint.textContent = 'Click a block to select, then press Delete or Backspace to remove';
            hint.classList.remove('active');
        }
    }

    renderTimeline() {
        const container = document.getElementById('timeline');
        const categories = storage.getTasks();
        const PX_PER_HOUR = 44;
        const HOUR_MS = 3600000;

        const today = new Date();
        const todayEntries = storage.getTimeEntriesForDate(today);

        // Comparison date (null in 'today' mode)
        let compareDate = null;
        let compareEntries = [];
        if (this.timelineMode !== 'today') {
            compareDate = new Date();
            compareDate.setDate(today.getDate() - (this.timelineMode === 'vs-yesterday' ? 1 : 7));
            compareEntries = storage.getTimeEntriesForDate(compareDate);
        }

        // Update legend
        const legendEl = document.getElementById('timelineLegend');
        if (legendEl) {
            if (compareDate) {
                const todayStr = today.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
                const compareStr = compareDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
                const compareTitle = this.timelineMode === 'vs-yesterday' ? 'Yesterday' : '7 Days Ago';
                legendEl.style.display = 'flex';
                legendEl.innerHTML = `
                    <span class="legend-today">Today · ${todayStr}</span>
                    <span class="legend-compare">${compareTitle} · ${compareStr}</span>
                `;
            } else {
                legendEl.style.display = 'none';
                legendEl.innerHTML = '';
            }
        }

        if (todayEntries.length === 0 && compareEntries.length === 0) {
            container.innerHTML = '<div class="timeline-empty">No time tracked yet today</div>';
            return;
        }

        // Normalize a past entry's datetime to today's date, keeping the same time-of-day
        const normalizeTime = (isoStr) => {
            const src = new Date(isoStr);
            const norm = new Date();
            norm.setHours(src.getHours(), src.getMinutes(), src.getSeconds(), src.getMilliseconds());
            return norm;
        };

        // Unified time window covering all entries (past entries normalized to today's time-of-day)
        const windowStart = new Date(); windowStart.setHours(6, 0, 0, 0);
        const windowEnd = new Date(); windowEnd.setHours(22, 0, 0, 0);
        todayEntries.forEach(e => {
            const s = new Date(e.start); const en = new Date(e.end);
            if (s < windowStart) windowStart.setTime(s.getTime());
            if (en > windowEnd) windowEnd.setTime(en.getTime());
        });
        compareEntries.forEach(e => {
            const s = normalizeTime(e.start); const en = normalizeTime(e.end);
            if (s < windowStart) windowStart.setTime(s.getTime());
            if (en > windowEnd) windowEnd.setTime(en.getTime());
        });
        windowStart.setMinutes(0, 0, 0);
        if (windowEnd.getMinutes() !== 0 || windowEnd.getSeconds() !== 0 || windowEnd.getMilliseconds() !== 0) {
            windowEnd.setHours(windowEnd.getHours() + 1, 0, 0, 0);
        }

        const totalMs = windowEnd - windowStart;
        const trackHeight = (totalMs / HOUR_MS) * PX_PER_HOUR;
        const totalHours = Math.round(totalMs / HOUR_MS);

        // Hour labels every 2 hours
        let hourLabels = '';
        for (let h = 0; h <= totalHours; h += 2) {
            const labelDate = new Date(windowStart.getTime() + h * HOUR_MS);
            hourLabels += `<div class="timeline-hour-label" style="top:${h * PX_PER_HOUR}px">${this.formatHour(labelDate)}</div>`;
        }

        // Consecutive same-category entries with only a short gap between them (i.e.
        // an uninterrupted focus session — break gaps absorbed, no switch to another
        // category) are merged into one continuous block. Threshold = break + buffer.
        const mergeGapMs = (storage.getSettings().breakMinutes || 5) * 60000 + 120000;
        const mergeSegments = (catEntries, past) => {
            const sorted = catEntries
                .map(e => ({
                    id: e.id,
                    s: past ? normalizeTime(e.start) : new Date(e.start),
                    en: past ? normalizeTime(e.end) : new Date(e.end)
                }))
                .sort((a, b) => a.s - b.s);
            const segs = [];
            for (const e of sorted) {
                const last = segs[segs.length - 1];
                if (last && (e.s - last.en) <= mergeGapMs) {
                    last.en = e.en;
                    last.workMs += (e.en - e.s);
                    last.ids.push(e.id);
                } else {
                    segs.push({ start: e.s, en: e.en, workMs: (e.en - e.s), ids: [e.id] });
                }
            }
            return segs;
        };

        // Build column HTML for a set of entries; past=true normalizes times to today
        const buildColumns = (entries, past) => {
            const cols = categories.filter(cat => entries.some(e => e.taskId === cat.id));
            if (cols.length === 0) {
                return `<div class="timeline-group-empty" style="height:${trackHeight}px">No entries</div>`;
            }
            return cols.map(cat => {
                const color = cat.color || '#2563eb';
                const blocks = mergeSegments(entries.filter(e => e.taskId === cat.id), past)
                    .map(seg => {
                        const top = ((seg.start - windowStart) / HOUR_MS) * PX_PER_HOUR;
                        const height = Math.max(16, ((seg.en - seg.start) / HOUR_MS) * PX_PER_HOUR);
                        const mins = Math.max(1, Math.round(seg.workMs / 60000));
                        const timeStr = `${seg.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–${seg.en.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
                        const idAttr = seg.ids.join(',');
                        const isSelected = idAttr === this.selectedEntryId;
                        const pastClass = past ? ' timeline-block--past' : '';
                        return `<div class="timeline-block${isSelected ? ' selected' : ''}${pastClass}" data-entry-id="${idAttr}" style="top:${top}px; height:${height}px; background:${color}" title="${this.escapeHtml(cat.name)} · ${timeStr}">${mins}m</div>`;
                    }).join('');

                return `
                    <div class="timeline-column">
                        <div class="timeline-column-header" title="${this.escapeHtml(cat.name)}">
                            <span class="category-dot" style="background:${color}"></span>
                            <span class="timeline-column-name">${this.escapeHtml(cat.name)}</span>
                        </div>
                        <div class="timeline-column-track" style="height:${trackHeight}px">${blocks}</div>
                    </div>
                `;
            }).join('');
        };

        const todayColumnsHtml = buildColumns(todayEntries, false);
        const compareHtml = compareDate
            ? `<div class="timeline-group-divider"></div>${buildColumns(compareEntries, true)}`
            : '';

        container.innerHTML = `
            <div class="timeline-axis">
                <div class="timeline-axis-header"></div>
                <div class="timeline-axis-track" style="height:${trackHeight}px">${hourLabels}</div>
            </div>
            <div class="timeline-columns">
                ${todayColumnsHtml}${compareHtml}
            </div>
        `;
    }

    formatHour(date) {
        let h = date.getHours();
        const ampm = h >= 12 ? 'pm' : 'am';
        h = h % 12;
        if (h === 0) h = 12;
        return `${h}${ampm}`;
    }

    // Focus session (Pomodoro) — driven by clicking a category
    onCategoryClick(categoryId) {
        // Already running this category? Do nothing.
        if (this.sessionRunning && this.activeCategoryId === categoryId) return;
        // Switching categories: stop the current session (logs partial work) first.
        if (this.sessionRunning) this.stopSession();
        this.startSession(categoryId);
    }

    startSession(categoryId) {
        this.getAudioContext(); // unlock/resume audio while we have a user gesture
        this.requestNotifyPermission(); // ask once, on this user gesture
        this.activeCategoryId = categoryId;
        this.sessionRunning = true;
        this.workPeriodsCompleted = 0;
        this.beginWork();
        this.renderSessionShell();
        this.startTicking();
        this.onTick();
        this.renderCategoryList();
    }

    // Period boundaries are timestamp-based: each new period starts exactly at the
    // previous period's end (`from`), so logged blocks stay accurate even if ticks
    // were throttled while the tab was backgrounded. `from` omitted = start now.
    beginWork(from) {
        const settings = storage.getSettings();
        const start = from || new Date();
        this.sessionMode = 'work';
        this.workSegmentStart = start;
        this.sessionEndTime = new Date(start.getTime() + settings.workMinutes * 60 * 1000);
    }

    beginBreak(from) {
        const settings = storage.getSettings();
        const start = from || new Date();
        this.sessionMode = 'break';
        this.workSegmentStart = null;
        this.sessionEndTime = new Date(start.getTime() + settings.breakMinutes * 60 * 1000);
    }

    getRepetitions() {
        const r = parseInt(storage.getSettings().repetitions);
        return isNaN(r) || r < 0 ? 0 : r;
    }

    // --- Tick driver (Web Worker, with a setInterval fallback) ---
    startTicking() {
        if (window.Worker) {
            try {
                if (!this.timerWorker) {
                    this.timerWorker = new Worker('timer-worker.js');
                    this.timerWorker.onmessage = () => this.onTick();
                }
                this.timerWorker.postMessage('start');
                return;
            } catch (e) {
                console.warn('Timer worker unavailable; using setInterval fallback', e);
            }
        }
        this.sessionIntervalId = setInterval(() => this.onTick(), 250);
    }

    stopTicking() {
        if (this.timerWorker) this.timerWorker.postMessage('stop');
        if (this.sessionIntervalId) {
            clearInterval(this.sessionIntervalId);
            this.sessionIntervalId = null;
        }
    }

    onTick() {
        if (!this.sessionRunning) return;
        // Process any elapsed period boundaries (also catches up after background throttling)
        while (this.sessionRunning && Date.now() >= this.sessionEndTime.getTime()) {
            this.handlePeriodEnd();
        }
        if (!this.sessionRunning) return;
        const remainingSec = Math.max(0, Math.floor((this.sessionEndTime.getTime() - Date.now()) / 1000));
        this.updateSessionTimeText(remainingSec);
    }

    handlePeriodEnd() {
        this.playAlarm();
        const boundary = new Date(this.sessionEndTime); // exact end of the period that just finished

        if (this.sessionMode === 'work') {
            storage.addTimeEntry(this.activeCategoryId, this.workSegmentStart, boundary, 'pomodoro-work');
            this.workPeriodsCompleted++;
            this.updateDailyTotal();
            this.renderCategoryList();

            const reps = this.getRepetitions();
            if (reps > 0 && this.workPeriodsCompleted >= reps) {
                // Final set done — stop cleanly (block already logged, so no partial re-log)
                this.notify('Session complete', `Finished ${reps} set${reps > 1 ? 's' : ''} of focus.`);
                this.workSegmentStart = null;
                this.stopSession();
                return;
            }
            this.notify('Break time', 'Focus period done — take a break.');
            this.beginBreak(boundary);
        } else {
            this.notify('Back to focus', 'Break over — back to work.');
            this.beginWork(boundary);
        }
    }

    stopSession() {
        if (!this.sessionRunning) return;

        this.sessionRunning = false;
        this.stopTicking();

        // Log partial work if we stopped mid-work session
        if (this.sessionMode === 'work' && this.workSegmentStart) {
            const now = new Date();
            if (now - this.workSegmentStart >= 1000) {
                storage.addTimeEntry(this.activeCategoryId, this.workSegmentStart, now, 'pomodoro-work');
            }
        }

        this.activeCategoryId = null;
        this.workSegmentStart = null;
        this.sessionEndTime = null;
        this.updateDailyTotal();
        this.renderCategoryList();
        this.renderSessionArea();
    }

    // Build the session UI once. The Stop button is a stable node with a real
    // listener so it can't be destroyed mid-click (the old per-tick innerHTML
    // rebuild was dropping clicks — that's why "Stop" sometimes didn't work).
    renderSessionShell() {
        const category = storage.getTasks().find(c => c.id === this.activeCategoryId);
        const color = category?.color || '#2563eb';
        const name = this.escapeHtml(category?.name || 'Session');

        const area = document.getElementById('sessionArea');
        area.innerHTML = `
            <div class="session-category">
                <span class="category-dot" style="background:${color}"></span>
                <span class="session-category-name">${name}</span>
            </div>
            <div class="session-status session-${this.sessionMode}" id="sessionStatus">Focus</div>
            <div class="session-display" id="sessionDisplay" style="color:${color}">--</div>
            <button class="btn-secondary" id="stopSessionBtn">Stop</button>
        `;
        document.getElementById('stopSessionBtn').addEventListener('click', () => this.stopSession());
    }

    updateSessionTimeText(remainingSec) {
        const disp = document.getElementById('sessionDisplay');
        const status = document.getElementById('sessionStatus');
        if (!disp || !status) { this.renderSessionShell(); return; }
        disp.textContent = this.formatSeconds(remainingSec);
        status.textContent = this.sessionMode === 'work' ? 'Focus' : 'Break';
        status.className = `session-status session-${this.sessionMode}`;
    }

    renderSessionArea() {
        const area = document.getElementById('sessionArea');
        if (this.sessionRunning) {
            this.renderSessionShell();
            this.onTick();
        } else {
            area.innerHTML = '<p class="no-session">Click a category to start a focus session</p>';
        }
    }

    // --- Background notifications ---
    requestNotifyPermission() {
        try {
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
        } catch (e) { /* not supported */ }
    }

    notify(title, body) {
        try {
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification(title, { body, tag: 'time-tracker-pomodoro', renotify: true });
            }
        } catch (e) { /* ignore */ }
    }

    // Daily total
    updateDailyTotal() {
        const totalSec = storage.getTotalTimeForDate();
        const timeStr = this.formatSeconds(totalSec);
        document.getElementById('dailyTotal').textContent = timeStr;
        this.renderTimeline();
    }

    // Alarms
    getAlarmChoice() {
        const choice = storage.getSettings().alarmSound;
        return ['beep', 'chime', 'bell', 'flash', 'flash-beep'].includes(choice) ? choice : 'beep';
    }

    getAudioContext() {
        try {
            if (!this.audioCtx) {
                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }
        } catch (e) {
            console.log('Audio context unavailable:', e);
            this.audioCtx = null;
        }
        return this.audioCtx;
    }

    // Play a single tone with a quick attack and exponential decay
    playTone(ctx, freq, startOffset, duration, type = 'sine', peak = 0.3) {
        const t = ctx.currentTime + startOffset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        osc.start(t);
        osc.stop(t + duration + 0.03);
    }

    playBeep(ctx) {
        this.playTone(ctx, 880, 0, 0.15, 'sine', 0.3);
        this.playTone(ctx, 880, 0.2, 0.15, 'sine', 0.3);
    }

    playChime(ctx) {
        this.playTone(ctx, 523.25, 0, 0.25, 'sine', 0.3);    // C5
        this.playTone(ctx, 659.25, 0.18, 0.25, 'sine', 0.3); // E5
        this.playTone(ctx, 783.99, 0.36, 0.5, 'sine', 0.3);  // G5
    }

    playBell(ctx) {
        // Fundamental plus partials with a long decay for a metallic ring
        this.playTone(ctx, 587.33, 0, 1.6, 'triangle', 0.35);
        this.playTone(ctx, 1174.66, 0, 1.4, 'sine', 0.15);
        this.playTone(ctx, 1760, 0, 1.0, 'sine', 0.06);
    }

    flashScreen() {
        const overlay = document.getElementById('flashOverlay');
        if (!overlay) return;
        overlay.classList.remove('flashing');
        // Force reflow so the animation restarts even on back-to-back triggers
        void overlay.offsetWidth;
        overlay.classList.add('flashing');
        overlay.addEventListener('animationend', () => {
            overlay.classList.remove('flashing');
        }, { once: true });
    }

    playAlarm() {
        const choice = this.getAlarmChoice();

        if (choice === 'flash' || choice === 'flash-beep') {
            this.flashScreen();
            if (choice === 'flash') return;
        }

        const ctx = this.getAudioContext();
        if (!ctx) return;
        try {
            if (choice === 'chime') this.playChime(ctx);
            else if (choice === 'bell') this.playBell(ctx);
            else this.playBeep(ctx); // 'beep' and 'flash-beep'
        } catch (e) {
            console.log('Alarm playback failed:', e);
        }
    }

    // Utilities
    formatSeconds(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});

// Storage wrapper: localStorage (offline cache) + Supabase (cloud sync)

class Storage {
    constructor() {
        this.db = {
            tasks: [],
            timeEntries: [],
            settings: {
                workMinutes: 30,
                breakMinutes: 5,
                alarmSound: 'beep',
                repetitions: 0 // 0 = unlimited; local-only (not synced to Supabase)
            }
        };

        this.supabase = null;
        this.user = null;
        this.syncEnabled = false;
        this.subscriptions = [];
        this.supabaseInitialized = false;

        // Sync coordination: avoid a realtime pull clobbering an in-flight push
        this._syncing = false;
        this._pendingPull = false;
        this._pullTimer = null;

        this.loadFromLocalStorage();
    }

    // Collision-resistant id. Date.now() alone collides when two rows are created
    // in the same millisecond (rapid category switching, back-to-back logs), and on
    // upsert the second row silently overwrites the first — a data-loss path.
    newId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }

    // Local calendar-day key (YYYY-MM-DD). Using UTC (toISOString) mis-buckets
    // entries around the UTC day rollover for negative-offset timezones, so an
    // afternoon entry can drop off "today" in the evening.
    localDateKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    async initSupabase() {
        if (this.supabaseInitialized) return;

        // NOTE: config.js declares `const CONFIG`, which does NOT attach to
        // window. Reference the bare global via scope chain, not window.CONFIG.
        if (typeof CONFIG === 'undefined' || !CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
            console.warn('Supabase config not found; running offline-only');
            this.supabaseInitialized = true;
            return;
        }

        // Wait for Supabase client to be available (up to 5 seconds)
        let retries = 0;
        while (!window.supabase && retries < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            retries++;
        }

        if (!window.supabase) {
            console.warn('Supabase client failed to load; running offline-only');
            this.supabaseInitialized = true;
            return;
        }

        try {
            // Load Supabase client from CDN
            const { createClient } = window.supabase;
            this.supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
            console.log('Supabase initialized successfully');

            // Listen for auth state changes
            this.supabase.auth.onAuthStateChange((event, session) => {
                this.user = session?.user || null;
                if (this.user) {
                    this.syncEnabled = true;
                } else {
                    this.syncEnabled = false;
                    this.unsubscribeAll();
                }
                // Swap the view IMMEDIATELY. The cloud push/pull used to be awaited
                // right here, so the Sign In button sat on "Signing in..." for as
                // long as the sync took, or forever when it stalled. Local data is
                // already on screen; the sync only adds what the cloud has.
                if (window.app) window.app.onAuthChange?.(this.user);
                if (this.user) {
                    // Defer to a fresh tick: supabase-js holds its auth lock while
                    // notifying subscribers, and every from() call needs that lock
                    // to read the access token. Awaiting queries inside this
                    // callback is the deadlock the Supabase docs warn about.
                    setTimeout(() => this.initialSync(), 0);
                }
            });
            this.supabaseInitialized = true;
        } catch (e) {
            console.error('Failed to initialize Supabase:', e);
            this.supabaseInitialized = true;
        }
    }

    // Runs after every sign-in / session restore. Push local (offline/pending)
    // rows UP first so the pull can't wipe anything that never reached the
    // cloud, then pull. Coalesces overlapping calls (INITIAL_SESSION and
    // SIGNED_IN often fire back to back).
    initialSync() {
        if (this._initialSyncPromise) return this._initialSyncPromise;
        this._initialSyncPromise = (async () => {
            try { await this.syncToCloud(); } catch (e) { console.error('Initial push failed:', e); }
            try { await this.pullFromCloud(); } catch (e) { console.error('Initial pull failed:', e); }
        })().finally(() => { this._initialSyncPromise = null; });
        return this._initialSyncPromise;
    }

    // Upsert in batches: one request per chunk instead of one per row (153
    // entries used to mean 153 sequential round-trips on every sign-in). If a
    // chunk is rejected, retry its rows one at a time so a single bad row
    // can't block the rest of the sync.
    //
    // Self-healing for schema drift: if the live table lacks a column the app
    // sends (PostgREST PGRST204 "Could not find the 'color' column of 'tasks'"),
    // drop that column from the rows and retry, and remember it for the rest
    // of the session. Without this, ONE missing column made every category
    // upsert fail, which made every time entry fail on its foreign key, and
    // nothing ever reached the cloud (Time Tracker project, Jul to Sep 2026).
    async upsertRows(table, rows, label, chunkSize = 200) {
        this._missingColumns = this._missingColumns || {};
        const strip = (row) => {
            const missing = this._missingColumns[table];
            if (!missing || !missing.size) return row;
            const copy = { ...row };
            missing.forEach(col => delete copy[col]);
            return copy;
        };
        for (let i = 0; i < rows.length; i += chunkSize) {
            let chunk = rows.slice(i, i + chunkSize).map(strip);
            let { error } = await this.supabase.from(table).upsert(chunk);
            for (let attempt = 0; error && attempt < 5; attempt++) {
                const col = this.missingColumnFromError(error);
                if (!col) break;
                console.warn(`Cloud table '${table}' has no column '${col}'; syncing without it. Run supabase-setup.sql on this project to add it.`);
                (this._missingColumns[table] = this._missingColumns[table] || new Set()).add(col);
                chunk = chunk.map(strip);
                ({ error } = await this.supabase.from(table).upsert(chunk));
            }
            if (!error) continue;
            console.warn(`Batch upsert of ${chunk.length} ${label} rows failed; retrying individually`, error);
            for (const row of chunk) {
                const { error: rowError } = await this.supabase.from(table).upsert(row);
                if (rowError) console.error(`Failed to sync ${label}`, row.id, rowError);
            }
        }
    }

    missingColumnFromError(error) {
        const m = /Could not find the '([^']+)' column|column "?\w+"?\."?(\w+)"? does not exist/i.exec(error?.message || '');
        return m ? (m[1] || m[2]) : null;
    }

    // Auth methods (email + password)
    async signUpWithPassword(email, password) {
        if (!this.supabaseInitialized) {
            await this.initSupabase();
        }
        if (!this.supabase) {
            throw new Error('Supabase not initialized. Please refresh the page and try again.');
        }
        const { data, error } = await this.supabase.auth.signUp({ email, password });
        if (error) throw error;
        // If "Confirm email" is disabled in Supabase, data.session is present and
        // onAuthStateChange signs the user in immediately. If it's enabled,
        // data.session is null until the user confirms via email.
        return data;
    }

    async signInWithPassword(email, password) {
        if (!this.supabaseInitialized) {
            await this.initSupabase();
        }
        if (!this.supabase) {
            throw new Error('Supabase not initialized. Please refresh the page and try again.');
        }
        const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    }

    // Legacy email OTP/magic-link methods (kept but no longer used by the UI)
    async signInWithEmail(email) {
        // Initialize Supabase if not already done
        if (!this.supabaseInitialized) {
            await this.initSupabase();
        }

        if (!this.supabase) {
            throw new Error('Supabase not initialized. Please refresh the page and try again.');
        }
        try {
            // Request a pure OTP (6-digit code) email. We deliberately DO NOT
            // pass emailRedirectTo: setting it makes Supabase generate a magic
            // LINK email, which can leave the 6-digit {{ .Token }} empty in the
            // template. Code-based sign-in (verifyEmailCode) needs no redirect,
            // so omitting it both fixes the empty-code problem and sidesteps the
            // Site URL / Redirect URL allowlist and email link pre-scanning.
            const { data, error } = await this.supabase.auth.signInWithOtp({
                email: email,
                options: {
                    shouldCreateUser: true
                }
            });
            if (error) throw error;
            return data;
        } catch (e) {
            console.error('Sign in error:', e);
            throw e;
        }
    }

    // Verify the 6-digit code from the email (redirect-free sign-in).
    async verifyEmailCode(email, token) {
        if (!this.supabaseInitialized) {
            await this.initSupabase();
        }
        if (!this.supabase) {
            throw new Error('Supabase not initialized. Please refresh the page and try again.');
        }
        const { data, error } = await this.supabase.auth.verifyOtp({
            email: email,
            token: String(token).trim(),
            type: 'email'
        });
        if (error) throw error;
        // onAuthStateChange will fire and drive the app into the signed-in state.
        return data;
    }

    async signOut() {
        if (!this.supabase) return;
        await this.supabase.auth.signOut();
    }

    getUser() {
        return this.user;
    }

    // Local storage
    loadFromLocalStorage() {
        const stored = localStorage.getItem('workTrackerData');
        if (stored) {
            try {
                this.db = JSON.parse(stored);
            } catch (e) {
                console.error('Failed to parse stored data:', e);
            }
        } else {
            this.saveToLocalStorage();
        }
    }

    saveToLocalStorage() {
        localStorage.setItem('workTrackerData', JSON.stringify(this.db));
    }

    // Unified persist: save to localStorage + sync to Supabase
    async persist() {
        this.saveToLocalStorage();
        if (this.syncEnabled && this.supabase) {
            try {
                await this.syncToCloud();
            } catch (e) {
                console.error('Sync to cloud failed (will retry on next change):', e);
            }
        }
    }

    // Cloud sync methods
    async pullFromCloud() {
        if (!this.supabase || !this.user) return;

        try {
            const [tasks, settings, timeEntries] = await Promise.all([
                this.supabase.from('tasks').select('*').eq('user_id', this.user.id),
                this.supabase.from('settings').select('*').eq('user_id', this.user.id).single(),
                this.supabase.from('time_entries').select('*').eq('user_id', this.user.id)
            ]);

            if (tasks.error) throw tasks.error;
            if (timeEntries.error) throw timeEntries.error;

            // Normalize Supabase snake_case columns to local camelCase schema.
            // MERGE, don't overwrite: cloud is authoritative for rows it has, but
            // local-only rows (not yet synced — e.g. just-created or mid-session)
            // are RETAINED as pending uploads. A wholesale replace here was the
            // core data-loss bug (offline categories / fresh entries erased).
            // If the cloud table has no color column (see upsertRows), keep the
            // color this device already has rather than resetting it to blue.
            const localColor = new Map(this.db.tasks.map(t => [t.id, t.color]));
            const cloudTasks = (tasks.data || []).map(t => ({
                id: t.id,
                name: t.name,
                color: t.color || localColor.get(t.id) || '#2563eb',
                createdAt: t.created_at,
                deleted: t.deleted || false
            }));
            const cloudTaskIds = new Set(cloudTasks.map(t => t.id));
            // PURE UNION: always keep local-only rows. A pull must never be able to
            // delete a local category — even if the cloud read is empty/partial
            // (RLS quirk, lag, or the DB rejecting writes). Task deletes are SOFT
            // (deleted=true rides along in the cloud row), so a real delete still
            // propagates through cloudTasks without needing to drop anything here.
            const localOnlyTasks = this.db.tasks.filter(t => !cloudTaskIds.has(t.id));
            this.db.tasks = [...cloudTasks, ...localOnlyTasks];

            // The cloud columns were created as TIMESTAMP (no zone), which drops
            // the trailing "Z" the app writes and hands back a bare clock time
            // that JS would parse as LOCAL time (every entry shifted by the UTC
            // offset; a 5pm PDT session came back as 12am). The stored clock
            // is UTC, so restore the marker before caching.
            const asUtc = (ts) => (typeof ts === 'string' && !/(Z|[+-]\d\d:?\d\d)$/.test(ts)) ? ts + 'Z' : ts;
            const cloudEntries = (timeEntries.data || []).map(e => ({
                id: e.id,
                taskId: e.task_id,
                start: asUtc(e.start),
                end: asUtc(e.end),
                durationSec: e.duration_sec,
                type: e.type || 'tracked'
            }));
            const cloudEntryIds = new Set(cloudEntries.map(e => e.id));
            const localOnlyEntries = this.db.timeEntries.filter(e => !cloudEntryIds.has(e.id));
            this.db.timeEntries = [...cloudEntries, ...localOnlyEntries];

            if (settings.data) {
                this.db.settings = {
                    ...this.db.settings, // preserve local-only fields (e.g. repetitions)
                    workMinutes: settings.data.work_minutes || 30,
                    breakMinutes: settings.data.break_minutes || 5,
                    alarmSound: settings.data.alarm_sound || 'beep'
                };
            }

            this.saveToLocalStorage();
            this.setupRealtimeSubscriptions(); // no-op if already subscribed
            // Reflect freshly-pulled cloud data (incl. cross-device changes) in the UI
            if (window.app) window.app.refreshUI?.();
        } catch (e) {
            console.error('Failed to pull from cloud:', e);
        }
    }

    async syncToCloud() {
        if (!this.supabase || !this.user) return;

        this._syncing = true;
        try {
            // Sync tasks — INCLUDING deleted ones (so soft-deletes propagate and a
            // deleted category can't resurrect on the next pull).
            await this.upsertRows('tasks', this.db.tasks.map(task => ({
                id: task.id,
                user_id: this.user.id,
                name: task.name,
                color: task.color || '#2563eb',
                created_at: task.createdAt,
                deleted: !!task.deleted
            })), 'task');

            // Sync time entries
            await this.upsertRows('time_entries', this.db.timeEntries.map(entry => ({
                id: entry.id,
                user_id: this.user.id,
                task_id: entry.taskId,
                "start": entry.start,
                "end": entry.end,
                duration_sec: entry.durationSec,
                type: entry.type
            })), 'time entry');

            // Sync settings
            try {
                const { error: settingsError } = await this.supabase.from('settings').upsert({
                    user_id: this.user.id,
                    work_minutes: this.db.settings.workMinutes,
                    break_minutes: this.db.settings.breakMinutes,
                    alarm_sound: this.db.settings.alarmSound
                });
                if (settingsError) throw settingsError;
            } catch (e) {
                console.error('Failed to sync settings', e);
            }
        } finally {
            this._syncing = false;
            // A realtime pull that arrived mid-sync was deferred — run it now.
            if (this._pendingPull) {
                this._pendingPull = false;
                this.pullFromCloud();
            }
        }
    }

    setupRealtimeSubscriptions() {
        if (!this.supabase || !this.user) return;
        // Subscribe ONCE. Previously this ran on every pull, tearing down and
        // rebuilding channels constantly (each self-upsert triggered a pull).
        if (this.subscriptions.length) return;

        // Subscribe to tasks changes
        const tasksSub = this.supabase
            .channel(`tasks:${this.user.id}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${this.user.id}` },
                (payload) => this.schedulePull()
            )
            .subscribe();

        // Subscribe to time entries changes
        const entriesSub = this.supabase
            .channel(`time_entries:${this.user.id}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'time_entries', filter: `user_id=eq.${this.user.id}` },
                (payload) => this.schedulePull()
            )
            .subscribe();

        // Subscribe to settings changes
        const settingsSub = this.supabase
            .channel(`settings:${this.user.id}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'settings', filter: `user_id=eq.${this.user.id}` },
                (payload) => this.schedulePull()
            )
            .subscribe();

        this.subscriptions = [tasksSub, entriesSub, settingsSub];
    }

    // Debounce bursty realtime events into a single pull, and never pull while a
    // push is in flight (that race could overwrite the row currently being saved).
    schedulePull() {
        if (this._pullTimer) clearTimeout(this._pullTimer);
        this._pullTimer = setTimeout(() => {
            this._pullTimer = null;
            if (this._syncing) { this._pendingPull = true; return; }
            this.pullFromCloud();
        }, 500);
    }

    unsubscribeAll() {
        for (const sub of this.subscriptions) {
            this.supabase.removeChannel(sub);
        }
        this.subscriptions = [];
    }

    // Task methods (same interface, now with sync)
    getTasks() {
        return this.db.tasks.filter(t => !t.deleted);
    }

    addTask(name, color = '#2563eb') {
        const task = {
            id: this.newId(),
            name,
            color,
            createdAt: new Date().toISOString(),
            deleted: false
        };
        this.db.tasks.push(task);
        this.persist();
        return task;
    }

    updateTask(id, name) {
        const task = this.db.tasks.find(t => t.id === id);
        if (task) {
            task.name = name;
            this.persist();
        }
        return task;
    }

    deleteTask(id) {
        const task = this.db.tasks.find(t => t.id === id);
        if (task) {
            task.deleted = true; // soft-delete; syncToCloud now propagates deleted=true
        }
        this.db.timeEntries = this.db.timeEntries.filter(e => e.taskId !== id);
        this.persist();
        // Hard-delete the task's entries from the cloud too (we removed them locally,
        // and the task row is kept-but-flagged, so ON DELETE CASCADE won't fire).
        if (this.syncEnabled && this.supabase) {
            this.supabase.from('time_entries').delete().eq('task_id', id)
                .then(({ error }) => {
                    if (error) console.error('Failed to delete task entries from cloud:', error);
                });
        }
    }

    // Time entry methods
    addTimeEntry(taskId, startTime, endTime, type = 'tracked') {
        const durationSec = Math.floor((endTime - startTime) / 1000);
        const entry = {
            id: this.newId(),
            taskId,
            start: startTime.toISOString(),
            end: endTime.toISOString(),
            durationSec,
            type
        };
        this.db.timeEntries.push(entry);
        this.persist();
        return entry;
    }

    getTimeEntriesForTask(taskId) {
        return this.db.timeEntries.filter(e => e.taskId === taskId);
    }

    getTimeEntriesForDate(date = new Date()) {
        // Compare LOCAL calendar days (not UTC) so evening entries don't fall off
        // "today" after the UTC rollover.
        const dateStr = this.localDateKey(date);
        return this.db.timeEntries.filter(e => this.localDateKey(new Date(e.start)) === dateStr);
    }

    getTotalTimeForTaskOnDate(taskId, date = new Date()) {
        const entries = this.getTimeEntriesForDate(date);
        return entries
            .filter(e => e.taskId === taskId)
            .reduce((sum, e) => sum + e.durationSec, 0);
    }

    getTotalTimeForDate(date = new Date()) {
        const entries = this.getTimeEntriesForDate(date);
        return entries.reduce((sum, e) => sum + e.durationSec, 0);
    }

    deleteTimeEntry(id) {
        this.db.timeEntries = this.db.timeEntries.filter(e => e.id !== id);
        this.saveToLocalStorage();
        if (this.syncEnabled && this.supabase) {
            this.supabase.from('time_entries').delete().eq('id', id)
                .then(({ error }) => {
                    if (error) console.error('Failed to delete time entry from cloud:', error);
                });
        }
    }

    // Update an entry's span (used by live-tracking autosave and manual block edits).
    updateTimeEntry(id, startISO, endISO) {
        const entry = this.db.timeEntries.find(e => e.id === id);
        if (!entry) return null;
        entry.start = startISO;
        entry.end = endISO;
        entry.durationSec = Math.max(0, Math.floor((new Date(endISO) - new Date(startISO)) / 1000));
        this.saveToLocalStorage();
        if (this.syncEnabled && this.supabase) {
            this.supabase.from('time_entries').upsert({
                id: entry.id,
                user_id: this.user.id,
                task_id: entry.taskId,
                "start": entry.start,
                "end": entry.end,
                duration_sec: entry.durationSec,
                type: entry.type
            }).then(({ error }) => {
                if (error) console.error('Failed to update time entry in cloud:', error);
            });
        }
        return entry;
    }

    // Settings methods
    getSettings() {
        return this.db.settings;
    }

    updateSettings(updates) {
        this.db.settings = { ...this.db.settings, ...updates };
        this.persist();
    }
}

const storage = new Storage();

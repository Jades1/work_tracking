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
        // Ids we've confirmed exist in the cloud. Lets the merge distinguish a
        // local-only row that is PENDING upload (keep it) from one that was
        // DELETED on another device (drop it) — otherwise deletes would resurrect.
        this._syncedIds = new Set();

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
            this.supabase.auth.onAuthStateChange(async (event, session) => {
                this.user = session?.user || null;
                if (this.user) {
                    this.syncEnabled = true;
                    // Push local (offline/pending) data UP before pulling, so the
                    // first pull can't wipe rows that never reached the cloud yet.
                    try { await this.syncToCloud(); } catch (e) { console.error('Initial push failed:', e); }
                    await this.pullFromCloud();
                } else {
                    this.syncEnabled = false;
                    this.unsubscribeAll();
                }
                // Notify app of auth change
                if (window.app) window.app.onAuthChange?.(this.user);
            });
            this.supabaseInitialized = true;
        } catch (e) {
            console.error('Failed to initialize Supabase:', e);
            this.supabaseInitialized = true;
        }
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
            const cloudTasks = (tasks.data || []).map(t => ({
                id: t.id,
                name: t.name,
                color: t.color || '#2563eb',
                createdAt: t.created_at,
                deleted: t.deleted || false
            }));
            const cloudTaskIds = new Set(cloudTasks.map(t => t.id));
            // Keep a local-only task only if it was never synced (pending upload);
            // if it was synced before but is now absent from cloud, it was deleted.
            const localOnlyTasks = this.db.tasks.filter(t => !cloudTaskIds.has(t.id) && !this._syncedIds.has(t.id));
            this.db.tasks = [...cloudTasks, ...localOnlyTasks];
            cloudTaskIds.forEach(id => this._syncedIds.add(id));

            const cloudEntries = (timeEntries.data || []).map(e => ({
                id: e.id,
                taskId: e.task_id,
                start: e.start,
                end: e.end,
                durationSec: e.duration_sec,
                type: e.type || 'tracked'
            }));
            const cloudEntryIds = new Set(cloudEntries.map(e => e.id));
            const localOnlyEntries = this.db.timeEntries.filter(e => !cloudEntryIds.has(e.id) && !this._syncedIds.has(e.id));
            this.db.timeEntries = [...cloudEntries, ...localOnlyEntries];
            cloudEntryIds.forEach(id => this._syncedIds.add(id));

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
            // deleted category can't resurrect on the next pull). Each upsert is
            // isolated: one failing row must not abort the rest of the sync (that
            // was silently blocking time_entries from ever reaching the cloud).
            for (const task of this.db.tasks) {
                try {
                    const { error } = await this.supabase.from('tasks').upsert({
                        id: task.id,
                        user_id: this.user.id,
                        name: task.name,
                        color: task.color || '#2563eb',
                        created_at: task.createdAt,
                        deleted: !!task.deleted
                    });
                    if (error) throw error;
                    this._syncedIds.add(task.id);
                } catch (e) {
                    console.error('Failed to sync task', task.id, e);
                }
            }

            // Sync time entries
            for (const entry of this.db.timeEntries) {
                try {
                    const { error } = await this.supabase.from('time_entries').upsert({
                        id: entry.id,
                        user_id: this.user.id,
                        task_id: entry.taskId,
                        "start": entry.start,
                        "end": entry.end,
                        duration_sec: entry.durationSec,
                        type: entry.type
                    });
                    if (error) throw error;
                    this._syncedIds.add(entry.id);
                } catch (e) {
                    console.error('Failed to sync time entry', entry.id, e);
                }
            }

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

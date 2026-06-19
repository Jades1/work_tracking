// Storage wrapper: localStorage (offline cache) + Supabase (cloud sync)

class Storage {
    constructor() {
        this.db = {
            tasks: [],
            timeEntries: [],
            settings: {
                workMinutes: 30,
                breakMinutes: 5,
                alarmSound: 'default'
            }
        };

        this.supabase = null;
        this.user = null;
        this.syncEnabled = false;
        this.subscriptions = [];
        this.supabaseInitialized = false;

        this.loadFromLocalStorage();
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
                    this.pullFromCloud();
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

    // Auth methods
    async signInWithEmail(email) {
        // Initialize Supabase if not already done
        if (!this.supabaseInitialized) {
            await this.initSupabase();
        }

        if (!this.supabase) {
            throw new Error('Supabase not initialized. Please refresh the page and try again.');
        }
        try {
            const { data, error } = await this.supabase.auth.signInWithOtp({
                email: email,
                options: {
                    emailRedirectTo: window.location.origin + window.location.pathname
                }
            });
            if (error) throw error;
            return data;
        } catch (e) {
            console.error('Sign in error:', e);
            throw e;
        }
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

            // Merge cloud data with local (cloud takes precedence if newer)
            this.db.tasks = tasks.data || [];
            this.db.timeEntries = timeEntries.data || [];

            if (settings.data) {
                this.db.settings = {
                    workMinutes: settings.data.work_minutes || 30,
                    breakMinutes: settings.data.break_minutes || 5,
                    alarmSound: settings.data.alarm_sound || 'default'
                };
            }

            this.saveToLocalStorage();
            this.setupRealtimeSubscriptions();
        } catch (e) {
            console.error('Failed to pull from cloud:', e);
        }
    }

    async syncToCloud() {
        if (!this.supabase || !this.user) return;

        try {
            // Sync tasks
            for (const task of this.db.tasks) {
                if (!task.deleted) {
                    const { error } = await this.supabase.from('tasks').upsert({
                        id: task.id,
                        user_id: this.user.id,
                        name: task.name,
                        color: task.color || '#2563eb',
                        created_at: task.createdAt,
                        deleted: false
                    });
                    if (error) throw error;
                }
            }

            // Sync time entries
            for (const entry of this.db.timeEntries) {
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
            }

            // Sync settings
            const { error: settingsError } = await this.supabase.from('settings').upsert({
                user_id: this.user.id,
                work_minutes: this.db.settings.workMinutes,
                break_minutes: this.db.settings.breakMinutes,
                alarm_sound: this.db.settings.alarmSound
            });
            if (settingsError) throw settingsError;
        } catch (e) {
            console.error('Failed to sync to cloud:', e);
            throw e;
        }
    }

    setupRealtimeSubscriptions() {
        if (!this.supabase || !this.user) return;

        this.unsubscribeAll();

        // Subscribe to tasks changes
        const tasksSub = this.supabase
            .channel(`tasks:${this.user.id}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${this.user.id}` },
                (payload) => this.pullFromCloud()
            )
            .subscribe();

        // Subscribe to time entries changes
        const entriesSub = this.supabase
            .channel(`time_entries:${this.user.id}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'time_entries', filter: `user_id=eq.${this.user.id}` },
                (payload) => this.pullFromCloud()
            )
            .subscribe();

        // Subscribe to settings changes
        const settingsSub = this.supabase
            .channel(`settings:${this.user.id}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'settings', filter: `user_id=eq.${this.user.id}` },
                (payload) => this.pullFromCloud()
            )
            .subscribe();

        this.subscriptions = [tasksSub, entriesSub, settingsSub];
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
            id: Date.now().toString(),
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
            task.deleted = true;
        }
        this.db.timeEntries = this.db.timeEntries.filter(e => e.taskId !== id);
        this.persist();
    }

    // Time entry methods
    addTimeEntry(taskId, startTime, endTime, type = 'tracked') {
        const durationSec = Math.floor((endTime - startTime) / 1000);
        const entry = {
            id: Date.now().toString(),
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
        const dateStr = date.toISOString().split('T')[0];
        return this.db.timeEntries.filter(e => {
            const entryDate = e.start.split('T')[0];
            return entryDate === dateStr;
        });
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

// Storage wrapper: provides a unified interface for localStorage + Supabase
// For now, this uses localStorage only; Supabase sync will be layered on later

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
        this.loadFromLocalStorage();
    }

    // Initialize data from localStorage
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

    // Save to localStorage
    saveToLocalStorage() {
        localStorage.setItem('workTrackerData', JSON.stringify(this.db));
    }

    // Persist any changes to both localStorage and Supabase (when ready)
    persist() {
        this.saveToLocalStorage();
        // TODO: sync to Supabase
    }

    // Tasks
    getTasks() {
        return this.db.tasks;
    }

    addTask(name) {
        const task = {
            id: Date.now().toString(),
            name,
            createdAt: new Date().toISOString()
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
        this.db.tasks = this.db.tasks.filter(t => t.id !== id);
        // Also remove any time entries for this task
        this.db.timeEntries = this.db.timeEntries.filter(e => e.taskId !== id);
        this.persist();
    }

    // Time entries
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

    // Get all time entries for a task
    getTimeEntriesForTask(taskId) {
        return this.db.timeEntries.filter(e => e.taskId === taskId);
    }

    // Get time entries for a specific date (defaults to today)
    getTimeEntriesForDate(date = new Date()) {
        const dateStr = date.toISOString().split('T')[0];
        return this.db.timeEntries.filter(e => {
            const entryDate = e.start.split('T')[0];
            return entryDate === dateStr;
        });
    }

    // Calculate total time (in seconds) for a task on a specific date
    getTotalTimeForTaskOnDate(taskId, date = new Date()) {
        const entries = this.getTimeEntriesForDate(date);
        return entries
            .filter(e => e.taskId === taskId)
            .reduce((sum, e) => sum + e.durationSec, 0);
    }

    // Calculate total time (in seconds) for a specific date
    getTotalTimeForDate(date = new Date()) {
        const entries = this.getTimeEntriesForDate(date);
        return entries.reduce((sum, e) => sum + e.durationSec, 0);
    }

    // Settings
    getSettings() {
        return this.db.settings;
    }

    updateSettings(updates) {
        this.db.settings = { ...this.db.settings, ...updates };
        this.persist();
    }
}

const storage = new Storage();

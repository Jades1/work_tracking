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
        this.sessionRunning = false;
        this.sessionMode = 'work'; // 'work' or 'break'
        this.sessionEndTime = null;
        this.sessionIntervalId = null;
        this.workSegmentStart = null;

        this.user = null;

        this.initEventListeners();
        this.renderColorPalette();
        this.checkAuthState();
    }

    checkAuthState() {
        this.user = storage.getUser();
        if (this.user) {
            this.showApp();
        } else {
            this.showAuthModal();
        }
    }

    onAuthChange(user) {
        this.user = user;
        if (user) {
            this.showApp();
        } else {
            this.showAuthModal();
        }
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

        if (this.user) {
            userEmail.textContent = this.user.email;
            signOutBtn.style.display = 'inline-block';
        } else {
            userEmail.textContent = '';
            signOutBtn.style.display = 'none';
        }
    }

    initEventListeners() {
        // Auth
        document.getElementById('signInBtn').addEventListener('click', () => this.signInWithEmail());
        document.getElementById('backBtn').addEventListener('click', () => this.showAuthForm());
        document.getElementById('authEmail').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.signInWithEmail();
        });
        document.getElementById('signOutBtn').addEventListener('click', () => this.signOut());

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

        // Initialize settings UI
        const settings = storage.getSettings();
        document.getElementById('workMinutes').value = settings.workMinutes;
        document.getElementById('breakMinutes').value = settings.breakMinutes;
    }

    async signInWithEmail() {
        const email = document.getElementById('authEmail').value.trim();
        if (!email) {
            alert('Please enter your email');
            return;
        }

        try {
            document.getElementById('signInBtn').disabled = true;
            document.getElementById('signInBtn').textContent = 'Sending...';
            await storage.signInWithEmail(email);
            this.showAuthMessage();
        } catch (e) {
            console.error('Sign in failed:', e);
            alert('Sign in failed: ' + e.message);
            document.getElementById('signInBtn').disabled = false;
            document.getElementById('signInBtn').textContent = 'Send Magic Link';
        }
    }

    showAuthForm() {
        document.getElementById('authForm').style.display = 'block';
        document.getElementById('authMessage').style.display = 'none';
        document.getElementById('authEmail').value = '';
        document.getElementById('signInBtn').disabled = false;
        document.getElementById('signInBtn').textContent = 'Send Magic Link';
    }

    showAuthMessage() {
        document.getElementById('authForm').style.display = 'none';
        document.getElementById('authMessage').style.display = 'block';
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

    renderTimeline() {
        const container = document.getElementById('timeline');
        const entries = storage.getTimeEntriesForDate();
        const categories = storage.getTasks();

        if (entries.length === 0) {
            container.innerHTML = '<div class="timeline-empty">No time tracked yet today</div>';
            return;
        }

        const PX_PER_HOUR = 44; // keep in sync with .timeline-*-track gridline spacing in styles.css
        const HOUR_MS = 3600000;

        // Window: default 6am–10pm, auto-expanded to include any earlier/later entries.
        const windowStart = new Date(); windowStart.setHours(6, 0, 0, 0);
        const windowEnd = new Date(); windowEnd.setHours(22, 0, 0, 0);
        entries.forEach(e => {
            const s = new Date(e.start);
            const en = new Date(e.end);
            if (s < windowStart) windowStart.setTime(s.getTime());
            if (en > windowEnd) windowEnd.setTime(en.getTime());
        });
        // Snap start down to the hour, end up to the hour
        windowStart.setMinutes(0, 0, 0);
        if (windowEnd.getMinutes() !== 0 || windowEnd.getSeconds() !== 0 || windowEnd.getMilliseconds() !== 0) {
            windowEnd.setHours(windowEnd.getHours() + 1, 0, 0, 0);
        }

        const totalMs = windowEnd - windowStart;
        const trackHeight = (totalMs / HOUR_MS) * PX_PER_HOUR;
        const totalHours = Math.round(totalMs / HOUR_MS);

        // Hour labels every 2 hours, aligned to the track
        let hourLabels = '';
        for (let h = 0; h <= totalHours; h += 2) {
            const labelDate = new Date(windowStart.getTime() + h * HOUR_MS);
            hourLabels += `<div class="timeline-hour-label" style="top:${h * PX_PER_HOUR}px">${this.formatHour(labelDate)}</div>`;
        }

        // One column per category that has logged time today (preserving category order)
        const columns = categories.filter(cat => entries.some(e => e.taskId === cat.id));

        const columnsHtml = columns.map(cat => {
            const color = cat.color || '#2563eb';
            const blocks = entries
                .filter(e => e.taskId === cat.id)
                .map(e => {
                    const s = new Date(e.start);
                    const en = new Date(e.end);
                    const top = ((s - windowStart) / HOUR_MS) * PX_PER_HOUR;
                    const height = Math.max(16, ((en - s) / HOUR_MS) * PX_PER_HOUR);
                    const mins = Math.max(1, Math.round((en - s) / 60000));
                    const timeStr = `${s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–${en.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
                    return `<div class="timeline-block" style="top:${top}px; height:${height}px; background:${color}" title="${this.escapeHtml(cat.name)} · ${timeStr}">${mins}m</div>`;
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

        container.innerHTML = `
            <div class="timeline-axis">
                <div class="timeline-axis-header"></div>
                <div class="timeline-axis-track" style="height:${trackHeight}px">${hourLabels}</div>
            </div>
            <div class="timeline-columns">${columnsHtml}</div>
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
        this.activeCategoryId = categoryId;
        this.sessionRunning = true;
        this.beginWork();
        this.sessionIntervalId = setInterval(() => this.updateSessionDisplay(), 200);
        this.updateSessionDisplay();
        this.renderCategoryList();
    }

    beginWork() {
        const settings = storage.getSettings();
        this.sessionMode = 'work';
        this.workSegmentStart = new Date();
        this.sessionEndTime = new Date(Date.now() + settings.workMinutes * 60 * 1000);
    }

    beginBreak() {
        const settings = storage.getSettings();
        this.sessionMode = 'break';
        this.workSegmentStart = null;
        this.sessionEndTime = new Date(Date.now() + settings.breakMinutes * 60 * 1000);
    }

    stopSession() {
        if (!this.sessionRunning) return;

        this.sessionRunning = false;
        clearInterval(this.sessionIntervalId);

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

    updateSessionDisplay() {
        if (!this.sessionRunning) return;

        const now = new Date();
        const remaining = Math.max(0, this.sessionEndTime - now);
        const remainingSec = Math.floor(remaining / 1000);

        if (remaining <= 0) {
            this.playAlarm();
            if (this.sessionMode === 'work') {
                // Log the completed work block, then roll into a break
                storage.addTimeEntry(this.activeCategoryId, this.workSegmentStart, this.sessionEndTime, 'pomodoro-work');
                this.updateDailyTotal();
                this.renderCategoryList();
                this.beginBreak();
            } else {
                // Break finished — back to work (timer keeps running)
                this.beginWork();
            }
            this.updateSessionDisplay();
            return;
        }

        const category = storage.getTasks().find(c => c.id === this.activeCategoryId);
        const color = category?.color || '#2563eb';
        const name = this.escapeHtml(category?.name || 'Session');
        const modeLabel = this.sessionMode === 'work' ? 'Focus' : 'Break';
        const timeStr = this.formatSeconds(remainingSec);

        const area = document.getElementById('sessionArea');
        area.innerHTML = `
            <div class="session-category">
                <span class="category-dot" style="background:${color}"></span>
                <span class="session-category-name">${name}</span>
            </div>
            <div class="session-status session-${this.sessionMode}">${modeLabel}</div>
            <div class="session-display" style="color:${color}">${timeStr}</div>
            <button class="btn-secondary" onclick="app.stopSession()">Stop</button>
        `;
    }

    renderSessionArea() {
        const area = document.getElementById('sessionArea');
        if (this.sessionRunning) {
            this.updateSessionDisplay();
        } else {
            area.innerHTML = '<p class="no-session">Click a category to start a focus session</p>';
        }
    }

    // Daily total
    updateDailyTotal() {
        const totalSec = storage.getTotalTimeForDate();
        const timeStr = this.formatSeconds(totalSec);
        document.getElementById('dailyTotal').textContent = timeStr;
        this.renderTimeline();
    }

    playAlarm() {
        // Simple beep using Web Audio API
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 800;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (e) {
            console.log('Audio context unavailable, using fallback');
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

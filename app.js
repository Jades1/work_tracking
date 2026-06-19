// UI Logic and state management

class App {
    constructor() {
        this.selectedTaskId = null;
        this.tracking = false;
        this.trackingStartTime = null;
        this.trackingIntervalId = null;

        this.pomodoroRunning = false;
        this.pomodoroMode = 'work'; // 'work' or 'break'
        this.pomodoroEndTime = null;
        this.pomodoroIntervalId = null;

        this.initEventListeners();
        this.renderTaskList();
        this.updateDailyTotal();
    }

    initEventListeners() {
        // Task input
        document.getElementById('addTaskBtn').addEventListener('click', () => this.addTask());
        document.getElementById('taskInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addTask();
        });

        // Pomodoro
        document.getElementById('startPomodoroBtn').addEventListener('click', () => this.startPomodoro());

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

    // Task Management
    addTask() {
        const input = document.getElementById('taskInput');
        const name = input.value.trim();
        if (!name) return;

        storage.addTask(name);
        input.value = '';
        this.renderTaskList();
    }

    deleteTask(id) {
        if (confirm('Delete this task?')) {
            storage.deleteTask(id);
            if (this.selectedTaskId === id) {
                this.selectedTaskId = null;
                this.stopTracking();
            }
            this.renderTaskList();
        }
    }

    selectTask(id) {
        this.selectedTaskId = id;
        this.renderTaskList();
    }

    renderTaskList() {
        const list = document.getElementById('taskList');
        const tasks = storage.getTasks();

        list.innerHTML = tasks.map(task => {
            const totalSec = storage.getTotalTimeForTaskOnDate(task.id);
            const timeStr = this.formatSeconds(totalSec);
            const isSelected = task.id === this.selectedTaskId;

            return `
                <li class="task-item ${isSelected ? 'active' : ''}" data-id="${task.id}">
                    <div class="task-item-left">
                        <span class="task-item-name">${this.escapeHtml(task.name)}</span>
                        <span class="task-item-time">Today: ${timeStr}</span>
                    </div>
                    <div class="task-item-actions">
                        <button class="btn-danger" onclick="app.deleteTask('${task.id}')">Delete</button>
                    </div>
                </li>
            `;
        }).join('');

        // Add click handlers to select tasks
        document.querySelectorAll('.task-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.closest('button')) {
                    this.selectTask(item.dataset.id);
                }
            });
        });
    }

    // Time Tracking
    startTracking() {
        if (!this.selectedTaskId) {
            alert('Please select a task first');
            return;
        }
        this.tracking = true;
        this.trackingStartTime = new Date();
        this.renderTimerArea();
        this.trackingIntervalId = setInterval(() => this.updateTimerDisplay(), 100);
    }

    stopTracking() {
        if (!this.tracking) return;

        this.tracking = false;
        clearInterval(this.trackingIntervalId);

        // Save the time entry
        storage.addTimeEntry(
            this.selectedTaskId,
            this.trackingStartTime,
            new Date(),
            'tracked'
        );

        this.trackingStartTime = null;
        this.renderTaskList();
        this.updateDailyTotal();
        this.renderTimerArea();
    }

    updateTimerDisplay() {
        if (!this.tracking) return;
        const elapsed = Math.floor((new Date() - this.trackingStartTime) / 1000);
        const timerArea = document.getElementById('timerArea');

        timerArea.innerHTML = `
            <div class="timer-display">${this.formatSeconds(elapsed)}</div>
            <div class="timer-controls">
                <button class="btn-primary" onclick="app.stopTracking()">Stop</button>
            </div>
        `;
    }

    renderTimerArea() {
        const timerArea = document.getElementById('timerArea');

        if (this.tracking) {
            this.updateTimerDisplay();
        } else if (!this.selectedTaskId) {
            timerArea.innerHTML = '<p class="no-task">Select a task to start tracking</p>';
        } else {
            timerArea.innerHTML = `
                <button class="btn-primary" onclick="app.startTracking()">Start Tracking</button>
            `;
        }
    }

    // Daily total
    updateDailyTotal() {
        const totalSec = storage.getTotalTimeForDate();
        const timeStr = this.formatSeconds(totalSec);
        document.getElementById('dailyTotal').textContent = timeStr;
    }

    // Pomodoro
    startPomodoro() {
        if (!this.selectedTaskId) {
            alert('Please select a task first');
            return;
        }

        this.pomodoroRunning = true;
        this.pomodoroMode = 'work';
        const settings = storage.getSettings();
        this.pomodoroEndTime = new Date(Date.now() + settings.workMinutes * 60 * 1000);
        this.pomodoroIntervalId = setInterval(() => this.updatePomodoroDisplay(), 100);
        this.updatePomodoroDisplay();
    }

    stopPomodoro() {
        this.pomodoroRunning = false;
        clearInterval(this.pomodoroIntervalId);
        document.getElementById('pomodoroArea').innerHTML = '<p class="no-session">Not running</p>';
    }

    updatePomodoroDisplay() {
        if (!this.pomodoroRunning) return;

        const now = new Date();
        const remaining = Math.max(0, this.pomodoroEndTime - now);
        const remainingSec = Math.floor(remaining / 1000);

        const pomodoroArea = document.getElementById('pomodoroArea');

        if (remainingSec <= 0) {
            this.playAlarm();
            this.transitionPomodoroMode();
        } else {
            const timeStr = this.formatSeconds(remainingSec);
            const modeLabel = this.pomodoroMode === 'work' ? 'Work' : 'Break';

            pomodoroArea.innerHTML = `
                <div class="pomodoro-status">${modeLabel} Time</div>
                <div class="pomodoro-display">${timeStr}</div>
                <button class="btn-secondary" onclick="app.stopPomodoro()">Stop</button>
            `;
        }
    }

    transitionPomodoroMode() {
        const settings = storage.getSettings();

        if (this.pomodoroMode === 'work') {
            // Save the work session as a time entry
            const workDuration = settings.workMinutes * 60 * 1000;
            const startTime = new Date(this.pomodoroEndTime - workDuration);
            storage.addTimeEntry(this.selectedTaskId, startTime, this.pomodoroEndTime, 'pomodoro-work');
            this.updateDailyTotal();
            this.renderTaskList();

            // Switch to break
            this.pomodoroMode = 'break';
            this.pomodoroEndTime = new Date(Date.now() + settings.breakMinutes * 60 * 1000);
        } else {
            // Switch back to work
            this.pomodoroMode = 'work';
            this.pomodoroEndTime = new Date(Date.now() + settings.workMinutes * 60 * 1000);
        }

        this.updatePomodoroDisplay();
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
            // Fallback: just log if audio API isn't available
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

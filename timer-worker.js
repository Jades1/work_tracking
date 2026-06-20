// Timer tick worker.
// Runs the session "tick" on a worker thread so it keeps firing even when the
// page is in a background tab (main-thread setInterval is throttled to ~once/min
// when hidden; a worker keeps a much steadier cadence). The worker only posts
// "tick" messages — all timing math + state lives in app.js, computed from
// absolute timestamps, so an occasional throttled tick still stays accurate.

let intervalId = null;

self.onmessage = (e) => {
    if (e.data === 'start') {
        if (intervalId === null) {
            intervalId = setInterval(() => self.postMessage('tick'), 250);
        }
    } else if (e.data === 'stop') {
        if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
        }
    }
};

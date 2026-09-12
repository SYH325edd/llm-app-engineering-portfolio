"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPageRefreshController = createPageRefreshController;
var DEFAULT_INTERVAL_MS = 60000;
function createPageRefreshController(page, refresh, intervalMs) {
    if (intervalMs === void 0) { intervalMs = DEFAULT_INTERVAL_MS; }
    var active = false;
    var timer = null;
    var running = null;
    var rerunRequested = false;
    var clearTimer = function () {
        if (timer !== null) { clearTimeout(timer); timer = null; }
    };
    var schedule = function () {
        clearTimer();
        if (!active) return;
        timer = setTimeout(function () { void run(); }, intervalMs);
    };
    var run = function () {
        clearTimer();
        if (running) { rerunRequested = true; return running; }
        running = Promise.resolve().then(function () { return refresh.call(page); });
        return running.finally(function () {
            running = null;
            if (!active) return;
            if (rerunRequested) { rerunRequested = false; void run(); return; }
            schedule();
        });
    };
    return {
        show: function () { active = true; return run(); },
        manual: function () { active = true; return run(); },
        hide: function () { active = false; rerunRequested = false; clearTimer(); },
        unload: function () { active = false; rerunRequested = false; clearTimer(); },
        isActive: function () { return active; }
    };
}

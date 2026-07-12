package com.codearts.bar.service;

final class RefreshCoordinator {
    private boolean running;
    private boolean pending;
    private boolean pendingNotification;
    private boolean disposed;

    synchronized Start request(boolean notifyOnError) {
        if (disposed) return Start.NONE;
        if (!running) {
            running = true;
            return new Start(true, notifyOnError);
        }
        pending = true;
        pendingNotification |= notifyOnError;
        return Start.NONE;
    }

    synchronized Start complete() {
        if (disposed) {
            running = false;
            pending = false;
            pendingNotification = false;
            return Start.NONE;
        }
        if (pending) {
            boolean notifyOnError = pendingNotification;
            pending = false;
            pendingNotification = false;
            return new Start(true, notifyOnError);
        }
        running = false;
        return Start.NONE;
    }

    synchronized boolean isRunning() { return running; }

    synchronized void abort() {
        running = false;
        pending = false;
        pendingNotification = false;
    }

    synchronized void dispose() {
        disposed = true;
        abort();
    }

    record Start(boolean run, boolean notifyOnError) {
        private static final Start NONE = new Start(false, false);
    }
}

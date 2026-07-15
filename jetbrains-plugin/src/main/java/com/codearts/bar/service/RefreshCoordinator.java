package com.codearts.bar.service;

import java.util.function.LongSupplier;

final class RefreshCoordinator {
    private static final long DEBOUNCE_MS = 500;
    private final LongSupplier clock;
    private boolean running;
    private boolean pending;
    private boolean pendingNotification;
    private boolean disposed;
    private long startedAtMs;

    RefreshCoordinator() { this(System::currentTimeMillis); }
    RefreshCoordinator(LongSupplier clock) { this.clock = clock; }

    synchronized Start request(boolean notifyOnError) {
        if (disposed) return Start.NONE;
        if (!running) {
            running = true;
            startedAtMs = clock.getAsLong();
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
            if (clock.getAsLong() - startedAtMs < DEBOUNCE_MS) {
                running = false;
                pending = false;
                pendingNotification = false;
                return Start.NONE;
            }
            boolean notifyOnError = pendingNotification;
            pending = false;
            pendingNotification = false;
            startedAtMs = clock.getAsLong();
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

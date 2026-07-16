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

    synchronized Start complete() { return complete(false, false); }

    synchronized Start complete(boolean requireFollowUp) { return complete(requireFollowUp, false); }

    synchronized Start complete(boolean requireFollowUp, boolean followUpNotification) {
        if (disposed) {
            running = false;
            pending = false;
            pendingNotification = false;
            return Start.NONE;
        }
        if (pending) {
            if (!requireFollowUp && clock.getAsLong() - startedAtMs < DEBOUNCE_MS) {
                running = false;
                pending = false;
                pendingNotification = false;
                return Start.NONE;
            }
            boolean notifyOnError = pendingNotification || followUpNotification;
            pending = false;
            pendingNotification = false;
            startedAtMs = clock.getAsLong();
            return new Start(true, notifyOnError);
        }
        if (requireFollowUp) {
            startedAtMs = clock.getAsLong();
            return new Start(true, followUpNotification);
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

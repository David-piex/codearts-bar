package com.codearts.bar.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class RefreshCoordinatorTest {
    @Test void runsImmediatelyWhenIdle() {
        RefreshCoordinator coordinator = new RefreshCoordinator();
        RefreshCoordinator.Start start = coordinator.request(false);
        assertTrue(start.run());
        assertFalse(start.notifyOnError());
        assertTrue(coordinator.isRunning());
        assertFalse(coordinator.complete().run());
        assertFalse(coordinator.isRunning());
    }

    @Test void coalescesConcurrentRequestsIntoOneFollowUpRun() {
        RefreshCoordinator coordinator = new RefreshCoordinator();
        assertTrue(coordinator.request(false).run());
        assertFalse(coordinator.request(false).run());
        assertFalse(coordinator.request(false).run());

        RefreshCoordinator.Start followUp = coordinator.complete();
        assertTrue(followUp.run());
        assertFalse(followUp.notifyOnError());
        assertTrue(coordinator.isRunning());
        assertFalse(coordinator.complete().run());
    }

    @Test void preservesNotificationIntentForFollowUpRun() {
        RefreshCoordinator coordinator = new RefreshCoordinator();
        assertTrue(coordinator.request(false).run());
        assertFalse(coordinator.request(true).run());
        assertFalse(coordinator.request(false).run());

        RefreshCoordinator.Start followUp = coordinator.complete();
        assertTrue(followUp.run());
        assertTrue(followUp.notifyOnError());
    }

    @Test void disposalDropsPendingAndFutureRuns() {
        RefreshCoordinator coordinator = new RefreshCoordinator();
        coordinator.request(false);
        coordinator.request(true);
        coordinator.dispose();

        assertFalse(coordinator.isRunning());
        assertFalse(coordinator.complete().run());
        assertFalse(coordinator.request(true).run());
    }

    @Test void abortedSubmissionClearsRunningAndPendingState() {
        RefreshCoordinator coordinator = new RefreshCoordinator();
        coordinator.request(false);
        coordinator.request(true);
        coordinator.abort();

        assertFalse(coordinator.isRunning());
        RefreshCoordinator.Start restart = coordinator.request(false);
        assertTrue(restart.run());
        assertFalse(restart.notifyOnError());
    }
}

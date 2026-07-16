package com.codearts.bar.service;

import com.codearts.bar.cli.CliProcessRunner;
import com.codearts.bar.cli.CliLocator;
import com.codearts.bar.model.UsageSnapshot;
import com.codearts.bar.model.SensitiveText;
import com.codearts.bar.model.DataSourceIdentity;
import com.codearts.bar.settings.CodeArtsSettings;
import com.intellij.notification.NotificationGroupManager;
import com.intellij.notification.NotificationType;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.components.Service;
import com.intellij.util.concurrency.AppExecutorUtil;

import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Future;
import java.util.concurrent.FutureTask;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import com.google.gson.JsonObject;

@Service(Service.Level.APP)
public final class CodeArtsDataService implements Disposable {
    private final CliProcessRunner runner = new CliProcessRunner();
    private final List<Consumer<UsageSnapshot>> listeners = new CopyOnWriteArrayList<>();
    private final RefreshCoordinator refreshCoordinator = new RefreshCoordinator();
    private final Set<Future<?>> activeTasks = ConcurrentHashMap.newKeySet();
    private volatile UsageSnapshot snapshot = UsageSnapshot.empty("等待首次刷新");
    private volatile ScheduledFuture<?> scheduled;
    private volatile boolean disposed;

    public CodeArtsDataService() { reschedule(); }
    public static CodeArtsDataService getInstance() { return ApplicationManager.getApplication().getService(CodeArtsDataService.class); }
    public UsageSnapshot getSnapshot() { return snapshot; }
    public boolean isRefreshing() { return refreshCoordinator.isRunning(); }

    public void refresh(boolean notifyOnError) {
        startRefresh(refreshCoordinator.request(notifyOnError));
    }

    private void startRefresh(RefreshCoordinator.Start start) {
        if (!start.run() || disposed) return;
        CodeArtsSettings.State settings = copySettings(CodeArtsSettings.getInstance().getState());
        String settingsIdentity = settingsIdentity(settings);
        try {
            submitTracked(() -> {
            boolean publish = false;
            try {
                UsageSnapshot loaded = runner.loadSnapshot(settings);
                if (settingsIdentity.equals(settingsIdentity(CodeArtsSettings.getInstance().getState()))) {
                    snapshot = loaded;
                    publish = true;
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } catch (Exception error) {
                if (settingsIdentity.equals(settingsIdentity(CodeArtsSettings.getInstance().getState()))) {
                    String message = SensitiveText.safeSummary(error.getMessage() == null ? error.toString() : error.getMessage());
                    snapshot = UsageSnapshot.empty(message);
                    publish = true;
                    if (start.notifyOnError()) ApplicationManager.getApplication().invokeLater(() -> {
                        if (!disposed) NotificationGroupManager.getInstance().getNotificationGroup("CodeArts Bar")
                                .createNotification("码道刷新失败", message, NotificationType.ERROR).notify(null);
                    });
                }
            } finally {
                if (publish) {
                    UsageSnapshot current = snapshot;
                    ApplicationManager.getApplication().invokeLater(() -> {
                        if (!disposed) listeners.forEach(listener -> listener.accept(current));
                    });
                }
                RefreshCoordinator.Start next = refreshCoordinator.complete(!publish && !disposed, start.notifyOnError());
                startRefresh(next);
            }
            });
        } catch (RuntimeException rejected) {
            refreshCoordinator.abort();
            if (!disposed) throw rejected;
        }
    }


    public Future<?> query(String resource, java.util.List<String> args, Consumer<JsonObject> onSuccess, Consumer<String> onError) {
        CodeArtsSettings.State settings = copySettings(CodeArtsSettings.getInstance().getState());
        String settingsIdentity = settingsIdentity(settings);
        return submitTracked(() -> {
            try {
                JsonObject data = runner.loadQuery(settings, resource, args);
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (!disposed && settingsIdentity.equals(settingsIdentity(CodeArtsSettings.getInstance().getState()))) onSuccess.accept(data);
                });
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } catch (Exception error) {
                String message = SensitiveText.safeSummary(error.getMessage() == null ? error.toString() : error.getMessage());
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (!disposed && settingsIdentity.equals(settingsIdentity(CodeArtsSettings.getInstance().getState()))) onError.accept(message);
                });
            }
        });
    }

    public Future<?> exportSession(java.util.List<String> args, Consumer<JsonObject> onSuccess, Consumer<String> onError) {
        CodeArtsSettings.State settings = copySettings(CodeArtsSettings.getInstance().getState());
        return submitTracked(() -> {
            try {
                JsonObject result = runner.exportSession(settings, args);
                ApplicationManager.getApplication().invokeLater(() -> { if (!disposed) onSuccess.accept(result); });
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } catch (Exception error) {
                String message = SensitiveText.safeSummary(error.getMessage() == null ? error.toString() : error.getMessage());
                ApplicationManager.getApplication().invokeLater(() -> { if (!disposed) onError.accept(message); });
            }
        });
    }

    public Future<?> exportSessions(java.util.List<String> args, Consumer<JsonObject> onSuccess, Consumer<String> onError) {
        CodeArtsSettings.State settings = copySettings(CodeArtsSettings.getInstance().getState());
        return submitTracked(() -> {
            try {
                JsonObject result = runner.exportSessions(settings, args);
                ApplicationManager.getApplication().invokeLater(() -> { if (!disposed) onSuccess.accept(result); });
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } catch (Exception error) {
                String message = SensitiveText.safeSummary(error.getMessage() == null ? error.toString() : error.getMessage());
                ApplicationManager.getApplication().invokeLater(() -> { if (!disposed) onError.accept(message); });
            }
        });
    }

    static CodeArtsSettings.State copySettings(CodeArtsSettings.State source) {
        CodeArtsSettings.State copy = new CodeArtsSettings.State();
        copy.nodePath = source.nodePath;
        copy.cliPath = source.cliPath;
        copy.dbPath = source.dbPath;
        copy.dailyLimit = source.dailyLimit;
        copy.windowHours = source.windowHours;
        copy.refreshSeconds = source.refreshSeconds;
        copy.timeoutSeconds = source.timeoutSeconds;
        copy.showStatusBar = source.showStatusBar;
        copy.analyticsRange = source.analyticsRange;
        copy.analyticsCustomStart = source.analyticsCustomStart;
        copy.analyticsCustomEnd = source.analyticsCustomEnd;
        copy.sessionRange = source.sessionRange;
        copy.sessionCustomStart = source.sessionCustomStart;
        copy.sessionCustomEnd = source.sessionCustomEnd;
        return copy;
    }

    static String settingsIdentity(CodeArtsSettings.State settings) {
        return String.join("\u001f",
                settings.nodePath == null ? "" : settings.nodePath.trim(),
                settings.cliPath == null ? "" : settings.cliPath.trim(),
                DataSourceIdentity.of(settings.dbPath),
                Long.toString(settings.dailyLimit),
                Integer.toString(settings.windowHours),
                Integer.toString(settings.timeoutSeconds));
    }

    private synchronized Future<?> submitTracked(Runnable action) {
        if (disposed) return java.util.concurrent.CompletableFuture.completedFuture(null);
        AtomicReference<FutureTask<Void>> reference = new AtomicReference<>();
        FutureTask<Void> task = new FutureTask<>(() -> {
            try { action.run(); }
            finally { activeTasks.remove(reference.get()); }
        }, null);
        reference.set(task);
        activeTasks.add(task);
        try {
            AppExecutorUtil.getAppExecutorService().execute(task);
        } catch (RuntimeException rejected) {
            activeTasks.remove(task);
            task.cancel(false);
            throw rejected;
        }
        return task;
    }

    public synchronized AutoCloseable subscribe(Consumer<UsageSnapshot> listener) {
        if (disposed) return () -> { };
        listeners.add(listener);
        listener.accept(snapshot);
        return () -> listeners.remove(listener);
    }

    public synchronized void reschedule() {
        if (disposed) return;
        if (scheduled != null) scheduled.cancel(false);
        int seconds = Math.max(10, CodeArtsSettings.getInstance().getState().refreshSeconds);
        scheduled = AppExecutorUtil.getAppScheduledExecutorService().scheduleWithFixedDelay(() -> {
            if (!listeners.isEmpty()) refresh(false);
        }, 1, seconds, TimeUnit.SECONDS);
    }

    @Override public synchronized void dispose() {
        disposed = true;
        if (scheduled != null) scheduled.cancel(true);
        for (Future<?> task : activeTasks) task.cancel(true);
        activeTasks.clear();
        refreshCoordinator.dispose();
        listeners.clear();
        CliLocator.releaseEmbeddedRuntime();
    }
}

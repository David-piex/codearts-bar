package com.codearts.bar.service;

import com.codearts.bar.cli.CliProcessRunner;
import com.codearts.bar.model.UsageSnapshot;
import com.codearts.bar.settings.CodeArtsSettings;
import com.intellij.notification.NotificationGroupManager;
import com.intellij.notification.NotificationType;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.components.Service;
import com.intellij.util.concurrency.AppExecutorUtil;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import com.google.gson.JsonObject;

@Service(Service.Level.APP)
public final class CodeArtsDataService implements Disposable {
    private final CliProcessRunner runner = new CliProcessRunner();
    private final List<Consumer<UsageSnapshot>> listeners = new CopyOnWriteArrayList<>();
    private final AtomicBoolean refreshing = new AtomicBoolean();
    private volatile UsageSnapshot snapshot = UsageSnapshot.empty("等待首次刷新");
    private volatile ScheduledFuture<?> scheduled;

    public CodeArtsDataService() { reschedule(); }
    public static CodeArtsDataService getInstance() { return ApplicationManager.getApplication().getService(CodeArtsDataService.class); }
    public UsageSnapshot getSnapshot() { return snapshot; }

    public void refresh(boolean notifyOnError) {
        if (!refreshing.compareAndSet(false, true)) return;
        AppExecutorUtil.getAppExecutorService().execute(() -> {
            try {
                snapshot = runner.loadSnapshot(CodeArtsSettings.getInstance().getState());
            } catch (Exception error) {
                snapshot = UsageSnapshot.empty(error.getMessage() == null ? error.toString() : error.getMessage());
                if (notifyOnError) ApplicationManager.getApplication().invokeLater(() -> NotificationGroupManager.getInstance()
                        .getNotificationGroup("CodeArts Bar").createNotification("码道刷新失败", snapshot.error(), NotificationType.ERROR).notify(null));
            } finally {
                refreshing.set(false);
                UsageSnapshot current = snapshot;
                ApplicationManager.getApplication().invokeLater(() -> listeners.forEach(listener -> listener.accept(current)));
            }
        });
    }


    public void query(String resource, java.util.List<String> args, Consumer<JsonObject> onSuccess, Consumer<String> onError) {
        AppExecutorUtil.getAppExecutorService().execute(() -> {
            try {
                JsonObject payload = runner.loadQuery(CodeArtsSettings.getInstance().getState(), resource, args);
                ApplicationManager.getApplication().invokeLater(() -> onSuccess.accept(payload.getAsJsonObject("data")));
            } catch (Exception error) {
                String message = error.getMessage() == null ? error.toString() : error.getMessage();
                ApplicationManager.getApplication().invokeLater(() -> onError.accept(message));
            }
        });
    }

    public AutoCloseable subscribe(Consumer<UsageSnapshot> listener) {
        listeners.add(listener);
        listener.accept(snapshot);
        return () -> listeners.remove(listener);
    }

    public synchronized void reschedule() {
        if (scheduled != null) scheduled.cancel(false);
        int seconds = Math.max(10, CodeArtsSettings.getInstance().getState().refreshSeconds);
        scheduled = AppExecutorUtil.getAppScheduledExecutorService().scheduleWithFixedDelay(() -> refresh(false), 1, seconds, TimeUnit.SECONDS);
    }

    @Override public synchronized void dispose() { if (scheduled != null) scheduled.cancel(true); listeners.clear(); }
}

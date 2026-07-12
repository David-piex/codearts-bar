package com.codearts.bar.actions;

import com.codearts.bar.settings.CodeArtsSettings;
import com.codearts.bar.service.CodeArtsDataService;
import com.codearts.bar.model.UsageSnapshot;
import com.intellij.ide.actions.RevealFileAction;
import com.intellij.notification.NotificationGroupManager;
import com.intellij.notification.NotificationType;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.DumbAwareAction;
import org.jetbrains.annotations.NotNull;

import java.nio.file.InvalidPathException;
import java.nio.file.Files;
import java.nio.file.Path;

public final class OpenDataFolderAction extends DumbAwareAction {
    @Override public void actionPerformed(@NotNull AnActionEvent event) { openFolder(); }
    public static void openFolder() {
        try {
            UsageSnapshot snapshot = CodeArtsDataService.getInstance().getSnapshot();
            String actualDatabase = snapshot.ok() ? snapshot.dbPath() : "";
            String configured = CodeArtsSettings.getInstance().getState().dbPath;
            Path database = DataFolderResolver.resolveDatabase(actualDatabase, configured, System.getProperty("user.home"));
            Path folder = database.getParent();
            if (folder == null || !Files.isDirectory(folder)) {
                notifyFailure("本地数据目录不存在，请先在设置中确认数据库路径。");
                return;
            }
            if (!Files.isRegularFile(database)) {
                notifyFailure("数据库文件不存在，请在设置中重新选择 opencode.db。");
                return;
            }
            RevealFileAction.openFile(database);
        } catch (InvalidPathException error) {
            notifyFailure("数据库路径无效，请在设置中重新选择 opencode.db。");
        } catch (RuntimeException error) {
            notifyFailure("无法打开本地数据目录：" + safeMessage(error));
        }
    }

    private static void notifyFailure(String message) {
        NotificationGroupManager.getInstance().getNotificationGroup("CodeArts Bar")
                .createNotification("无法打开数据目录", message, NotificationType.WARNING).notify(null);
    }

    private static String safeMessage(RuntimeException error) {
        return error.getMessage() == null || error.getMessage().isBlank() ? error.getClass().getSimpleName() : error.getMessage();
    }
}

package com.codearts.bar.actions;

import com.codearts.bar.settings.CodeArtsSettings;
import com.intellij.ide.BrowserUtil;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import org.jetbrains.annotations.NotNull;

import java.nio.file.Path;

public final class OpenDataFolderAction extends AnAction {
    @Override public void actionPerformed(@NotNull AnActionEvent event) { openFolder(); }
    public static void openFolder() {
        String configured = CodeArtsSettings.getInstance().getState().dbPath;
        Path folder = configured == null || configured.isBlank()
                ? Path.of(System.getProperty("user.home"), ".codeartsdoer", "codearts-data")
                : Path.of(configured).toAbsolutePath().getParent();
        if (folder != null) BrowserUtil.browse(folder);
    }
}

package com.codearts.bar.actions;

import com.codearts.bar.service.CodeArtsDataService;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import org.jetbrains.annotations.NotNull;

public final class RefreshAction extends AnAction {
    @Override public void actionPerformed(@NotNull AnActionEvent event) { CodeArtsDataService.getInstance().refresh(true); }
}

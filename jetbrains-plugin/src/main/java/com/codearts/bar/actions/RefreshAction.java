package com.codearts.bar.actions;

import com.codearts.bar.service.CodeArtsDataService;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.DumbAwareAction;
import org.jetbrains.annotations.NotNull;

public final class RefreshAction extends DumbAwareAction {
    @Override public void actionPerformed(@NotNull AnActionEvent event) { CodeArtsDataService.getInstance().refresh(true); }
}

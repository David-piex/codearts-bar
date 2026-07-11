package com.codearts.bar.actions;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowManager;
import org.jetbrains.annotations.NotNull;

public final class OpenToolWindowAction extends AnAction {
    @Override public void actionPerformed(@NotNull AnActionEvent event) {
        if (event.getProject() == null) return;
        ToolWindow window = ToolWindowManager.getInstance(event.getProject()).getToolWindow("CodeArts Bar");
        if (window != null) window.show();
    }
}

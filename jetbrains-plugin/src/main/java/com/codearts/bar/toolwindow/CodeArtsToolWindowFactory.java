package com.codearts.bar.toolwindow;

import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;
import org.jetbrains.annotations.NotNull;

public final class CodeArtsToolWindowFactory implements ToolWindowFactory, DumbAware {
    @Override public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        CodeArtsDashboardPanel panel = new CodeArtsDashboardPanel(project);
        Content content = ContentFactory.getInstance().createContent(panel, "概览", false);
        content.setDisposer(panel);
        toolWindow.getContentManager().addContent(content);
    }
}

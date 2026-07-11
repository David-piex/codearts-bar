package com.codearts.bar.statusbar;

import com.codearts.bar.model.UsageSnapshot;
import com.codearts.bar.service.CodeArtsDataService;
import com.codearts.bar.settings.CodeArtsSettings;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.StatusBar;
import com.intellij.openapi.wm.StatusBarWidget;
import com.intellij.openapi.wm.StatusBarWidgetFactory;
import com.intellij.util.Consumer;
import org.jetbrains.annotations.Nls;
import org.jetbrains.annotations.NonNls;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.awt.event.MouseEvent;
import java.text.DecimalFormat;

public final class CodeArtsStatusBarWidgetFactory implements StatusBarWidgetFactory {
    @Override public @NotNull @NonNls String getId() { return "CodeArtsBarStatus"; }
    @Override public @NotNull @Nls String getDisplayName() { return "\u7801\u9053\u4f7f\u7528\u91cf"; }
    @Override public boolean isAvailable(@NotNull Project project) { return CodeArtsSettings.getInstance().getState().showStatusBar; }
    @Override public @NotNull StatusBarWidget createWidget(@NotNull Project project) { return new Widget(project); }
    @Override public void disposeWidget(@NotNull StatusBarWidget widget) { widget.dispose(); }
    @Override public boolean canBeEnabledOn(@NotNull StatusBar statusBar) { return true; }

    private static final class Widget implements StatusBarWidget, StatusBarWidget.TextPresentation {
        private final Project project;
        private UsageSnapshot snapshot = CodeArtsDataService.getInstance().getSnapshot();
        private AutoCloseable subscription;
        Widget(Project project) { this.project = project; }
        @Override public @NotNull String ID() { return "CodeArtsBarStatus"; }
        @Override public void install(@NotNull StatusBar statusBar) {
            subscription = CodeArtsDataService.getInstance().subscribe(value -> { snapshot = value; statusBar.updateWidget(ID()); });
        }
        @Override public void dispose() { if (subscription != null) try { subscription.close(); } catch (Exception ignored) {} }
        @Override public @Nullable WidgetPresentation getPresentation() { return this; }
        @Override public @NotNull String getText() { return snapshot.ok() ? "\u7801\u9053 " + compact(snapshot.todayTokens()) + " \u00b7 " + Math.round(snapshot.usagePercent()) + "%" : "\u7801\u9053 --"; }
        @Override public float getAlignment() { return 0.5f; }
        @Override public @Nullable String getTooltipText() {
            if (!snapshot.ok()) return "\u7801\u9053\uff1a" + snapshot.error();
            return "\u4eca\u65e5 " + format(snapshot.todayTokens()) + " Token\uff1b\u6700\u8fd1\u7a97\u53e3 " + format(snapshot.windowTokens()) + "\uff1b\u8bf7\u6c42 " + format(snapshot.requestCount()) + "\uff1b\u66f4\u65b0 " + snapshot.updatedAt();
        }
        @Override public @Nullable Consumer<MouseEvent> getClickConsumer() { return event -> { var window = com.intellij.openapi.wm.ToolWindowManager.getInstance(project).getToolWindow("CodeArts Bar"); if (window != null) window.show(); }; }
        private static String compact(long n) { if (n >= 1_000_000) return new DecimalFormat("0.0M").format(n / 1_000_000d); if (n >= 1_000) return new DecimalFormat("0.0K").format(n / 1_000d); return Long.toString(n); }
        private static String format(long n) { return new DecimalFormat("#,##0").format(n); }
    }
}

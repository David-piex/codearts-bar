package com.codearts.bar.toolwindow;

import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.util.ui.JBUI;

import javax.swing.*;
import java.awt.*;

final class SessionExportOptionsDialog extends DialogWrapper {
    private static final CodeArtsDashboardPanel.SessionExportOptions DEFAULTS =
            CodeArtsDashboardPanel.SessionExportOptions.defaults();
    private final JCheckBox includeContent = new JCheckBox("包含对话正文", DEFAULTS.includeContent());
    private final JCheckBox includeToolIO = new JCheckBox("包含工具输入输出", DEFAULTS.includeToolIO());
    private final JCheckBox redactPaths = new JCheckBox("脱敏本机路径与用户名", DEFAULTS.redactPaths());
    private final JCheckBox includeErrors = new JCheckBox("包含错误详情（脱敏摘要）", DEFAULTS.includeErrors());

    SessionExportOptionsDialog() {
        super(true);
        setTitle("导出隐私选项");
        setOKButtonText("下一步");
        init();
    }

    CodeArtsDashboardPanel.SessionExportOptions options() {
        return new CodeArtsDashboardPanel.SessionExportOptions(includeContent.isSelected(), includeToolIO.isSelected(),
                redactPaths.isSelected(), includeErrors.isSelected());
    }

    @Override protected JComponent createCenterPanel() {
        JPanel panel = new JPanel();
        panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
        panel.setBorder(JBUI.Borders.empty(8, 4, 4, 4));
        for (JCheckBox option : new JCheckBox[]{includeContent, includeToolIO, redactPaths, includeErrors}) {
            option.setAlignmentX(Component.LEFT_ALIGNMENT);
            panel.add(option);
            panel.add(Box.createVerticalStrut(JBUI.scale(6)));
        }
        panel.getAccessibleContext().setAccessibleName("会话导出隐私选项");
        return panel;
    }
}

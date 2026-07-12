package com.codearts.bar.settings;

import com.codearts.bar.service.CodeArtsDataService;
import com.intellij.openapi.fileChooser.FileChooser;
import com.intellij.openapi.fileChooser.FileChooserDescriptor;
import com.intellij.openapi.options.Configurable;
import com.intellij.openapi.options.ConfigurationException;
import com.intellij.openapi.ui.TextFieldWithBrowseButton;
import com.intellij.ui.components.*;
import com.intellij.util.ui.FormBuilder;
import org.jetbrains.annotations.Nls;
import org.jetbrains.annotations.Nullable;
import javax.swing.*;
import java.util.Objects;

public final class CodeArtsConfigurable implements Configurable {
    private JPanel panel;
    private TextFieldWithBrowseButton nodePath, cliPath, dbPath;
    private JBTextField dailyLimit, windowHours, refreshSeconds, timeoutSeconds;
    @Override public @Nls String getDisplayName(){return "CodeArts Bar";}
    @Override public @Nullable JComponent createComponent(){
        nodePath=pathField("选择 Node.js 可执行文件");
        cliPath=pathField("选择 codearts-bar bin.js 或 CLI 可执行文件");
        dbPath=pathField("选择 opencode.db");
        dailyLimit=new JBTextField();windowHours=new JBTextField();refreshSeconds=new JBTextField();timeoutSeconds=new JBTextField();
        panel=FormBuilder.createFormBuilder()
                .addLabeledComponent(new JBLabel("Node.js 路径："),nodePath)
                .addLabeledComponent(new JBLabel("CodeArts Bar CLI 路径："),cliPath)
                .addLabeledComponent(new JBLabel("数据库路径（opencode.db）："),dbPath)
                .addSeparator()
                .addLabeledComponent(new JBLabel("每日 Token 显示上限："),dailyLimit)
                .addLabeledComponent(new JBLabel("滚动窗口（小时）："),windowHours)
                .addLabeledComponent(new JBLabel("自动刷新（秒）："),refreshSeconds)
                .addLabeledComponent(new JBLabel("CLI 超时（秒）："),timeoutSeconds)
                .addComponent(new JBLabel("插件运行不需要另装 JDK；内嵌 CLI 仍需要 Node.js，可从 PATH 自动发现或手动指定。"))
                .addComponent(new JBLabel("CLI 与数据库路径可留空：默认使用内嵌 CLI，并自动查找 CodeArts Agent 本地数据库。"))
                .addComponent(new JBLabel("状态栏显示可在 IDEA 状态栏的“小组件”菜单中即时开关。"))
                .addComponentFillVertically(new JPanel(),0).getPanel();
        reset();return panel;
    }
    private static TextFieldWithBrowseButton pathField(String title){TextFieldWithBrowseButton field=new TextFieldWithBrowseButton();field.addActionListener(event->{FileChooserDescriptor descriptor=new FileChooserDescriptor(true,false,false,false,false,false).withTitle(title).withDescription("留空可使用自动发现。");var selected=FileChooser.chooseFile(descriptor,null,null);if(selected!=null)field.setText(selected.getPath());});return field;}
    @Override public boolean isModified(){
        CodeArtsSettings.State s=CodeArtsSettings.getInstance().getState();
        if(!Objects.equals(text(nodePath),s.nodePath)||!Objects.equals(text(cliPath),s.cliPath)||!Objects.equals(text(dbPath),s.dbPath)) return true;
        try {
            SettingsValues values=values();
            return values.dailyLimit()!=s.dailyLimit||values.windowHours()!=s.windowHours||values.refreshSeconds()!=s.refreshSeconds||values.timeoutSeconds()!=s.timeoutSeconds;
        } catch(IllegalArgumentException ignored){ return true; }
    }
    @Override public void apply() throws ConfigurationException {
        final SettingsValues values;
        try { values=values(); }
        catch(IllegalArgumentException error){ throw new ConfigurationException(error.getMessage(), "CodeArts Bar 设置无效"); }
        CodeArtsSettings.State s=CodeArtsSettings.getInstance().getState();
        s.nodePath=text(nodePath);s.cliPath=text(cliPath);s.dbPath=text(dbPath);
        s.dailyLimit=values.dailyLimit();s.windowHours=values.windowHours();s.refreshSeconds=values.refreshSeconds();s.timeoutSeconds=values.timeoutSeconds();
        CodeArtsDataService.getInstance().reschedule();CodeArtsDataService.getInstance().refresh(true);
    }
    @Override public void reset(){if(nodePath==null)return;CodeArtsSettings.State s=CodeArtsSettings.getInstance().getState();nodePath.setText(s.nodePath);cliPath.setText(s.cliPath);dbPath.setText(s.dbPath);dailyLimit.setText(Long.toString(s.dailyLimit));windowHours.setText(Integer.toString(s.windowHours));refreshSeconds.setText(Integer.toString(s.refreshSeconds));timeoutSeconds.setText(Integer.toString(s.timeoutSeconds));}
    private SettingsValues values(){return SettingsValues.parse(dailyLimit.getText(),windowHours.getText(),refreshSeconds.getText(),timeoutSeconds.getText());}
    private static String text(TextFieldWithBrowseButton f){return f.getText().trim();}
}

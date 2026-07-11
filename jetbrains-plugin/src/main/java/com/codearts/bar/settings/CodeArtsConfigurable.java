package com.codearts.bar.settings;

import com.codearts.bar.service.CodeArtsDataService;
import com.intellij.openapi.fileChooser.FileChooser;
import com.intellij.openapi.fileChooser.FileChooserDescriptor;
import com.intellij.openapi.options.Configurable;
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
    private JBCheckBox showStatusBar;
    @Override public @Nls String getDisplayName(){return "CodeArts Bar";}
    @Override public @Nullable JComponent createComponent(){
        nodePath=pathField("Select the Node.js executable");
        cliPath=pathField("Select codearts-bar bin.js or CLI executable");
        dbPath=pathField("Select opencode.db");
        dailyLimit=new JBTextField();windowHours=new JBTextField();refreshSeconds=new JBTextField();timeoutSeconds=new JBTextField();
        showStatusBar=new JBCheckBox("Show today's usage in the IDE status bar");
        panel=FormBuilder.createFormBuilder()
                .addLabeledComponent(new JBLabel("Node.js path:"),nodePath)
                .addLabeledComponent(new JBLabel("CodeArts Bar CLI path:"),cliPath)
                .addLabeledComponent(new JBLabel("opencode.db path:"),dbPath)
                .addSeparator()
                .addLabeledComponent(new JBLabel("Daily token display limit:"),dailyLimit)
                .addLabeledComponent(new JBLabel("Rolling window (hours):"),windowHours)
                .addLabeledComponent(new JBLabel("Automatic refresh (seconds):"),refreshSeconds)
                .addLabeledComponent(new JBLabel("CLI timeout (seconds):"),timeoutSeconds)
                .addComponent(showStatusBar)
                .addComponent(new JBLabel("Leave paths empty to discover codearts-bar from PATH and use the default ~/.codeartsdoer database."))
                .addComponentFillVertically(new JPanel(),0).getPanel();
        reset();return panel;
    }
    private static TextFieldWithBrowseButton pathField(String title){TextFieldWithBrowseButton field=new TextFieldWithBrowseButton();field.addActionListener(event->{FileChooserDescriptor descriptor=new FileChooserDescriptor(true,false,false,false,false,false).withTitle(title).withDescription("Leave empty for automatic discovery.");var selected=FileChooser.chooseFile(descriptor,null,null);if(selected!=null)field.setText(selected.getPath());});return field;}
    @Override public boolean isModified(){CodeArtsSettings.State s=CodeArtsSettings.getInstance().getState();return !Objects.equals(text(nodePath),s.nodePath)||!Objects.equals(text(cliPath),s.cliPath)||!Objects.equals(text(dbPath),s.dbPath)||longValue(dailyLimit,s.dailyLimit)!=s.dailyLimit||intValue(windowHours,s.windowHours)!=s.windowHours||intValue(refreshSeconds,s.refreshSeconds)!=s.refreshSeconds||intValue(timeoutSeconds,s.timeoutSeconds)!=s.timeoutSeconds||showStatusBar.isSelected()!=s.showStatusBar;}
    @Override public void apply(){CodeArtsSettings.State s=CodeArtsSettings.getInstance().getState();s.nodePath=text(nodePath);s.cliPath=text(cliPath);s.dbPath=text(dbPath);s.dailyLimit=Math.max(1,longValue(dailyLimit,200_000));s.windowHours=Math.max(1,Math.min(168,intValue(windowHours,24)));s.refreshSeconds=Math.max(10,intValue(refreshSeconds,60));s.timeoutSeconds=Math.max(5,intValue(timeoutSeconds,30));s.showStatusBar=showStatusBar.isSelected();CodeArtsDataService.getInstance().reschedule();CodeArtsDataService.getInstance().refresh(true);}
    @Override public void reset(){if(nodePath==null)return;CodeArtsSettings.State s=CodeArtsSettings.getInstance().getState();nodePath.setText(s.nodePath);cliPath.setText(s.cliPath);dbPath.setText(s.dbPath);dailyLimit.setText(Long.toString(s.dailyLimit));windowHours.setText(Integer.toString(s.windowHours));refreshSeconds.setText(Integer.toString(s.refreshSeconds));timeoutSeconds.setText(Integer.toString(s.timeoutSeconds));showStatusBar.setSelected(s.showStatusBar);}
    private static String text(TextFieldWithBrowseButton f){return f.getText().trim();}private static long longValue(JBTextField f,long d){try{return Long.parseLong(f.getText().trim());}catch(Exception ignored){return d;}}private static int intValue(JBTextField f,int d){try{return Integer.parseInt(f.getText().trim());}catch(Exception ignored){return d;}}
}

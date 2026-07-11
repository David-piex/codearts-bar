package com.codearts.bar.settings;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.components.PersistentStateComponent;
import com.intellij.openapi.components.Service;
import com.intellij.openapi.components.State;
import com.intellij.openapi.components.Storage;
import org.jetbrains.annotations.NotNull;

@Service(Service.Level.APP)
@State(name = "CodeArtsBarSettings", storages = @Storage("codearts-bar.xml"))
public final class CodeArtsSettings implements PersistentStateComponent<CodeArtsSettings.State> {
    public static final class State {
        public String nodePath = "";
        public String cliPath = "";
        public String dbPath = "";
        public long dailyLimit = 200_000;
        public int windowHours = 24;
        public int refreshSeconds = 60;
        public int timeoutSeconds = 30;
        public boolean showStatusBar = true;
    }

    private State state = new State();
    public static CodeArtsSettings getInstance() { return ApplicationManager.getApplication().getService(CodeArtsSettings.class); }
    @Override public @NotNull State getState() { return state; }
    @Override public void loadState(@NotNull State state) { this.state = state; }
}

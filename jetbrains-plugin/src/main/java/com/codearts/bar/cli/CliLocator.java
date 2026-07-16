package com.codearts.bar.cli;

import com.codearts.bar.settings.CodeArtsSettings;
import com.intellij.ide.plugins.PluginManagerCore;
import com.intellij.openapi.extensions.PluginId;
import com.intellij.openapi.util.SystemInfo;
import com.intellij.util.EnvironmentUtil;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;

public final class CliLocator {
    private CliLocator() {}
    public static List<String> snapshotCommand(CodeArtsSettings.State settings) throws IOException { return queryCommand(settings, "dashboard", List.of()); }
    public static List<String> queryCommand(CodeArtsSettings.State settings, String resource, List<String> args) throws IOException {
        return queryCommand(settings, resource, args, CliLocator::embeddedCli);
    }
    public static List<String> exportCommand(CodeArtsSettings.State settings, List<String> args) throws IOException {
        return exportCommand(settings, "export-session", args);
    }
    public static List<String> exportSessionsCommand(CodeArtsSettings.State settings, List<String> args) throws IOException {
        return exportCommand(settings, "export-sessions", args);
    }
    private static List<String> exportCommand(CodeArtsSettings.State settings, String operation, List<String> args) throws IOException {
        String cli=trim(settings.cliPath),node=trim(settings.nodePath);
        if(!node.isEmpty()&&!Files.isRegularFile(Path.of(node))) throw new IOException("Node.js 路径不存在，请在设置中重新选择可执行文件。");
        if(!cli.isEmpty()&&!Files.isRegularFile(Path.of(cli))) throw new IOException("CodeArts Bar CLI 路径不存在，请在设置中重新选择文件或留空使用内嵌 CLI。");
        List<String> exportArgs=new ArrayList<>(); exportArgs.add(operation); exportArgs.addAll(args);
        if(!cli.isEmpty()) return commandFor(cli,node,exportArgs.toArray(String[]::new));
        String dev=System.getProperty("codearts.bar.cli","");
        if(!dev.isBlank()&&Files.isRegularFile(Path.of(dev))) return commandFor(dev,node,exportArgs.toArray(String[]::new));
        Path queryEntry=embeddedCli();
        Path exportEntry=queryEntry.getParent().resolve("session-export-cli.js");
        if(!Files.isRegularFile(exportEntry)) throw new IOException("内嵌会话导出运行时缺失");
        return commandFor(exportEntry.toString(),node,exportArgs.toArray(String[]::new));
    }
    static List<String> queryCommand(CodeArtsSettings.State settings, String resource, List<String> args,
                                     EmbeddedCliProvider embeddedCliProvider) throws IOException {
        String cli=trim(settings.cliPath),node=trim(settings.nodePath);
        if(!node.isEmpty()&&!Files.isRegularFile(Path.of(node))) throw new IOException("Node.js 路径不存在，请在设置中重新选择可执行文件。");
        if(!cli.isEmpty()&&!Files.isRegularFile(Path.of(cli))) throw new IOException("CodeArts Bar CLI 路径不存在，请在设置中重新选择文件或留空使用内嵌 CLI。");
        if(!cli.isEmpty()) return commandFor(cli,node, join(resource,args));
        String dev=System.getProperty("codearts.bar.cli","");
        if(!dev.isBlank()&&Files.isRegularFile(Path.of(dev))) return commandFor(dev,node,join(resource,args));
        try {
            return commandFor(embeddedCliProvider.materialize().toString(),node,join(resource,args));
        } catch (IOException error) {
            throw new IOException("内嵌 CodeArts Bar CLI 无法准备：" + error.getMessage()
                    + "。请检查 IDE system 目录权限，或在设置中明确指定 CLI 路径。", error);
        }
    }
    public static Path embeddedCli() throws IOException { return EmbeddedCliRuntime.materialize(); }
    public static void releaseEmbeddedRuntime(){ EmbeddedCliRuntime.releaseRuntimeLock(); }
    static boolean repairEmbeddedRuntime(List<String> command){ return EmbeddedCliRuntime.repairAfterFailure(command); }
    private static String[] join(String resource,List<String> args){List<String> out=new ArrayList<>();out.add("query");out.add(resource);out.addAll(args);return out.toArray(String[]::new);}
    private static List<String> commandFor(String cli,String node,String...args){List<String> out=new ArrayList<>();if(cli.endsWith(".js")||cli.endsWith(".cjs"))out.add(node.isEmpty()?findOnPath(SystemInfo.isWindows?"node.exe":"node"):node);out.add(cli);out.addAll(List.of(args));return out;}
    static String findOnPath(String executable){Map<String,String> env=EnvironmentUtil.getEnvironmentMap();String path=env.getOrDefault("PATH",System.getenv().getOrDefault("PATH",""));for(String entry:path.split(java.io.File.pathSeparator)){if(entry.isBlank())continue;Path candidate=Path.of(entry,executable);if(Files.isRegularFile(candidate))return candidate.toString();}return executable;}
    private static String trim(String value){return value==null?"":value.trim();}
    @FunctionalInterface interface EmbeddedCliProvider { Path materialize() throws IOException; }
}

package com.codearts.bar.cli;

import com.codearts.bar.settings.CodeArtsSettings;
import com.intellij.ide.plugins.PluginManagerCore;
import com.intellij.openapi.extensions.PluginId;
import com.intellij.openapi.util.SystemInfo;
import com.intellij.util.EnvironmentUtil;
import java.nio.file.*;
import java.util.*;

public final class CliLocator {
    private CliLocator() {}
    public static List<String> snapshotCommand(CodeArtsSettings.State settings) { return queryCommand(settings, "dashboard", List.of()); }
    public static List<String> queryCommand(CodeArtsSettings.State settings, String resource, List<String> args) {
        String cli=trim(settings.cliPath),node=trim(settings.nodePath);
        if(!cli.isEmpty()) return commandFor(cli,node, join(resource,args));
        String dev=System.getProperty("codearts.bar.cli","");
        if(!dev.isBlank()&&Files.isRegularFile(Path.of(dev))) return commandFor(dev,node,join(resource,args));
        Path embedded=embeddedCli();
        if(embedded!=null) return commandFor(embedded.toString(),node,join(resource,args));
        List<String> out=new ArrayList<>();out.add(SystemInfo.isWindows?findOnPath("codearts-bar.cmd"):findOnPath("codearts-bar"));out.addAll(List.of(join(resource,args)));return out;
    }
    public static Path embeddedCli(){ return EmbeddedCliRuntime.materialize(); }
    private static String[] join(String resource,List<String> args){List<String> out=new ArrayList<>();out.add("query");out.add(resource);out.addAll(args);return out.toArray(String[]::new);}
    private static List<String> commandFor(String cli,String node,String...args){List<String> out=new ArrayList<>();if(cli.endsWith(".js")||cli.endsWith(".cjs"))out.add(node.isEmpty()?findOnPath("node"):node);out.add(cli);out.addAll(List.of(args));return out;}
    static String findOnPath(String executable){Map<String,String> env=EnvironmentUtil.getEnvironmentMap();String path=env.getOrDefault("PATH",System.getenv().getOrDefault("PATH",""));for(String entry:path.split(java.io.File.pathSeparator)){if(entry.isBlank())continue;Path candidate=Path.of(entry,executable);if(Files.isRegularFile(candidate))return candidate.toString();}return executable;}
    private static String trim(String value){return value==null?"":value.trim();}
}

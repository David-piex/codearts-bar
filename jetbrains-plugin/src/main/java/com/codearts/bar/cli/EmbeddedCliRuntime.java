package com.codearts.bar.cli;

import com.google.gson.JsonParser;
import com.intellij.openapi.application.PathManager;
import java.io.*;
import java.nio.file.*;
import java.util.*;

final class EmbeddedCliRuntime {
    private EmbeddedCliRuntime() {}
    static Path materialize() {
        try {
            var loader=EmbeddedCliRuntime.class.getClassLoader();
            try(InputStream stream=loader.getResourceAsStream("cli/CLI_RUNTIME_MANIFEST.json")){
                if(stream==null)return null;
                String json=new String(stream.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
                var manifest=JsonParser.parseString(json).getAsJsonObject();
                String version=manifest.has("generatedAt")?Integer.toHexString(json.hashCode()):"current";
                Path root=Path.of(PathManager.getSystemPath(),"codearts-bar","cli-"+version);
                List<String> files=new ArrayList<>();
                for(var item:manifest.getAsJsonArray("files"))files.add(item.getAsString());
                files.add("node_modules/sql.js/dist/sql-wasm.js");files.add("node_modules/sql.js/dist/sql-wasm.wasm");files.add("CLI_RUNTIME_MANIFEST.json");
                for(String file:files){Path target=root.resolve(file);if(Files.isRegularFile(target))continue;Files.createDirectories(target.getParent());try(InputStream input=loader.getResourceAsStream("cli/"+file)){if(input==null)throw new IOException("Missing embedded CLI resource: "+file);Path temp=target.resolveSibling(target.getFileName()+".tmp");Files.copy(input,temp,StandardCopyOption.REPLACE_EXISTING);try{Files.move(temp,target,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}catch(AtomicMoveNotSupportedException ignored){Files.move(temp,target,StandardCopyOption.REPLACE_EXISTING);}}}
                return root.resolve(manifest.get("entry").getAsString());
            }
        } catch(Exception ignored){return null;}
    }
}

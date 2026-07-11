# CodeArts Bar for JetBrains

JetBrains IntelliJ Platform 插件，为 IntelliJ IDEA、PyCharm、WebStorm、GoLand 等 IDE 提供 CodeArts Agent 本地使用数据概览。

## 当前能力

- IDE 状态栏显示今日 Token 与每日软上限占比
- 右侧“码道”工具窗口展示今日/滚动窗口用量、请求数、缓存命中率、模型与数据源
- 自动刷新和手动刷新
- Settings | Tools | CodeArts Bar 配置 Node.js、CLI、数据库和刷新间隔
- Tools 菜单中的刷新、打开分析和打开数据目录动作
- 通过现有 `codearts-bar snapshot` JSON 接口复用主项目聚合逻辑

## 本地运行

插件需要可执行的 Node.js 和 CodeArts Bar CLI。开发时可传入仓库 CLI：

```powershell
$env:JAVA_HOME="<JDK 21>"
.\gradlew runIde -Dcodearts.bar.cli="..\src\bin.js"
```

也可以在插件设置中填写：

- Node.js 路径，例如 `C:\Program Files\nodejs\node.exe`
- CLI 路径，例如本仓库的 `src\bin.js`，或 npm 安装后的 CLI 文件
- 可选的 `opencode.db` 路径

## 构建

```powershell
.\gradlew buildPlugin
```

ZIP 位于 `build/distributions/`。

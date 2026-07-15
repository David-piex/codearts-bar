# CodeArts Bar for JetBrains

JetBrains IntelliJ Platform 插件，为 IntelliJ IDEA、PyCharm、WebStorm、GoLand 等 IDE 提供 CodeArts Agent 本地使用数据概览。

## 当前能力

- IDE 状态栏显示今日 Token 与每日软上限占比，可通过 IDEA 原生“小组件”菜单即时开关
- 右侧“CodeArts Bar”工具窗口提供 **使用分析 / 会话管理 / 诊断** 三项主导航
- 使用分析支持今天、最近 24 小时、最近 7/14/30 天、全部时间和自定义起止时间；范围会统一作用于 Token、请求、输入/输出、缓存、趋势、模型和数据源统计
- 会话管理直接读取数据库分页，支持跨全部会话搜索和来源筛选；选择会话后查看请求列表，选择请求后查看 Token 与性能明细
- 会话详情支持打开目录和复制会话 ID，主从区域会随工具窗口宽度自适应
- 会话可导出为 JSON、Markdown 或真实 XLSX；导出前可选择正文、工具输入输出、路径脱敏和错误摘要
- 诊断页汇总数据库、SQLite adapter、延迟、错误和会话状态，并支持重试、打开设置/数据目录和复制脱敏报告
- 自动刷新和手动刷新
- Settings | Tools | CodeArts Bar 配置 Node.js、CLI、数据库和刷新间隔
- Tools 菜单中的刷新、打开分析和打开数据目录动作
- 通过共享的 `codearts-bar query` JSON 协议复用主项目聚合、搜索和数据库分页逻辑

## 运行依赖

插件支持 JetBrains IDE 2024.2、2024.3、2025.1、2025.2、2025.3 和 2026.1（build `242` 至 `261.*`），这些版本均已通过 Plugin Verifier。安装后的插件不需要用户另装 JDK，IDE 会使用自带的 JetBrains Runtime。插件内置 CodeArts Bar CLI，但执行该 CLI 需要 Node.js 18 或更高版本；可以从 `PATH` 自动发现，也可以在插件设置中指定路径，版本过低时插件会给出明确提示。

从源码运行或构建时，可以显式指定 JDK 21+：

```powershell
$env:JAVA_HOME="<JDK 21>"
.\gradlew runIde -Dcodearts.bar.cli="..\src\bin.js"
```

未配置 JDK 时，Windows 构建脚本会自动发现独立安装或 Toolbox 安装的 IDEA JBR 21+。macOS 和 Linux 需通过 `CODEARTS_BAR_JAVA_HOME`、`JAVA_HOME` 或 `PATH` 提供 Java 21+ 编译器；插件产物始终编译为 Java 21 字节码。

插件设置中可以填写：

- Node.js 路径，例如 `C:\Program Files\nodejs\node.exe`
- 可选 CLI 路径，例如本仓库的 `src\bin.js`，或 npm 安装后的 CLI 文件；留空使用内嵌 CLI
- 可选的 `opencode.db` 路径

## 构建

```powershell
.\gradlew buildPlugin
```

ZIP 位于 `build/distributions/`。

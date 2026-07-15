package com.codearts.bar.toolwindow;

import com.codearts.bar.actions.OpenDataFolderAction;
import com.codearts.bar.model.AnalyticsRange;
import com.codearts.bar.model.DataSourceIdentity;
import com.codearts.bar.model.QueryDisplayState;
import com.codearts.bar.model.SensitiveText;
import com.codearts.bar.model.UsageSnapshot;
import com.codearts.bar.service.CodeArtsDataService;
import com.codearts.bar.settings.CodeArtsSettings;
import com.google.gson.JsonObject;
import com.intellij.icons.AllIcons;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.options.ShowSettingsUtil;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.ui.SimpleToolWindowPanel;
import com.intellij.openapi.ui.ValidationInfo;
import com.intellij.ui.JBColor;
import com.intellij.ui.SearchTextField;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.components.JBScrollPane;
import com.intellij.ui.components.JBTextArea;
import com.intellij.ui.table.JBTable;
import com.intellij.util.ui.JBUI;

import javax.swing.*;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.event.PopupMenuEvent;
import javax.swing.event.PopupMenuListener;
import javax.swing.table.DefaultTableModel;
import java.awt.*;
import java.awt.datatransfer.StringSelection;
import java.awt.event.ComponentAdapter;
import java.awt.event.ComponentEvent;
import java.io.File;
import java.text.DateFormat;
import java.text.DecimalFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicLong;

import static com.codearts.bar.toolwindow.DashboardUi.*;

final class CodeArtsDashboardPanel extends SimpleToolWindowPanel implements Disposable {
    private static final int SESSION_PAGE_SIZE = 30;
    private static final int REQUEST_PAGE_SIZE = 50;
    private static final String VIEW_ANALYTICS = "analytics";
    private static final String VIEW_SESSIONS = "sessions";
    private static final String VIEW_DIAGNOSTICS = "diagnostics";

    private final Project project;
    private final CodeArtsDataService service = CodeArtsDataService.getInstance();
    private final CardLayout viewLayout = new CardLayout();
    private final JPanel viewDeck = new JPanel(viewLayout);
    private final CardLayout overviewStateLayout = new CardLayout();
    private final JPanel overviewStateDeck = new JPanel(overviewStateLayout);
    private final ViewToggleButton analyticsViewButton = viewButton("使用分析", true, () -> showView(VIEW_ANALYTICS));
    private final ViewToggleButton sessionsViewButton = viewButton("会话管理", false, () -> showView(VIEW_SESSIONS));
    private final ViewToggleButton diagnosticsViewButton = viewButton("诊断", false, () -> showView(VIEW_DIAGNOSTICS));
    private final JBTextArea overviewErrorDescription = stateDescription("打开诊断可查看原因，也可以检查 Node.js、CLI 与数据库路径。");

    private final JBLabel refreshState = new JBLabel("正在读取本地数据...");
    private final HeroMetricCard usageHero = new HeroMetricCard();
    private final MetricCard inputMetric = new MetricCard("新增输入", INPUT);
    private final MetricCard outputMetric = new MetricCard("输出", OUTPUT);
    private final MetricCard cacheWriteMetric = new MetricCard("缓存创建", CACHE_WRITE);
    private final MetricCard cacheReadMetric = new MetricCard("缓存命中", CACHE_READ);
    private final JBLabel sessionSummary = valueLabel("-- 个会话");
    private final MiniStatCard diagnosticDatabaseMetric = new MiniStatCard("数据库", ACCENT);
    private final MiniStatCard diagnosticLatencyMetric = new MiniStatCard("响应 P95", OUTPUT);
    private final MiniStatCard diagnosticErrorMetric = new MiniStatCard("错误", TOTAL);
    private final MiniStatCard diagnosticSessionMetric = new MiniStatCard("会话", CACHE_READ);

    private final JProgressBar cacheProgress = progressBar(CACHE_READ);
    private final JProgressBar quotaProgress = progressBar(ACCENT);
    private final JBLabel cacheRateValue = valueLabel("--");
    private final JBLabel cacheRateMeta = mutedLabel("等待缓存统计");
    private final JBLabel health = new JBLabel("数据状态待检查");
    private final JBLabel quotaValue = valueLabel("--");
    private final JBLabel quotaMeta = mutedLabel("每日软上限");
    private final TrendChartPanel chart = new TrendChartPanel();
    private final JComboBox<AnalyticsRange> usageRange = new JComboBox<>(AnalyticsRange.values());
    private final JComboBox<String> analyticsModel = new JComboBox<>(new String[]{"全部模型"});
    private final JComboBox<String> analyticsSource = new JComboBox<>(new String[]{"全部来源", "桌面端", "CLI", "自定义"});

    private final DefaultTableModel modelTable = model(new String[]{"模型", "Token", "请求", "P95"});
    private final DefaultTableModel sourceTable = model(new String[]{"来源", "Token", "请求", "错误"});
    private final DefaultTableModel providerTable = model(new String[]{"Provider", "Token", "请求", "错误"});
    private final DefaultTableModel sessionTable = model(new String[]{"会话", "Token", "更新"});
    private final DefaultTableModel requestTable = model(new String[]{"请求", "Token", "耗时", "状态"});
    private final DashboardUi.PolishedTable modelGrid = table(modelTable, "暂无模型统计");
    private final DashboardUi.PolishedTable sourceGrid = table(sourceTable, "暂无来源统计");
    private final DashboardUi.PolishedTable providerGrid = table(providerTable, "暂无 Provider 统计");
    private final DashboardUi.PolishedTable sessionGrid = table(sessionTable, "正在读取会话...");
    private final DashboardUi.PolishedTable requestGrid = table(requestTable, "选择会话后查看请求");

    private final SearchTextField sessionSearch = new SearchTextField(false);
    private final JComboBox<String> sessionSource = new JComboBox<>(new String[]{"全部来源", "桌面端", "CLI", "自定义"});
    private final JComboBox<String> sessionModel = new JComboBox<>(new String[]{"全部模型"});
    private final JComboBox<UsageSnapshot.ProjectInfo> sessionProject = new JComboBox<>();
    private final JComboBox<AnalyticsRange> sessionTimeRange = new JComboBox<>(new AnalyticsRange[]{
            AnalyticsRange.ALL_TIME, AnalyticsRange.TODAY, AnalyticsRange.LAST_24_HOURS,
            AnalyticsRange.LAST_7_DAYS, AnalyticsRange.LAST_14_DAYS, AnalyticsRange.LAST_30_DAYS,
            AnalyticsRange.CUSTOM
    });
    private final JBLabel sessionPageLabel = mutedLabel("第 1 页");
    private final JBLabel requestPageLabel = mutedLabel("请选择一个会话");
    private final JButton previousSessions = button("上一页", null);
    private final JButton nextSessions = button("下一页", null);
    private final JButton previousRequests = button("上一页", null);
    private final JButton nextRequests = button("下一页", null);
    private final SessionInspectorHeader sessionInspector = new SessionInspectorHeader();
    private final JButton openSessionFolder = button("打开目录", this::openSelectedSessionFolder);
    private final JButton copySessionId = button("复制 ID", this::copySelectedSessionId);
    private final JButton exportSessionButton = button("导出", this::showSessionExportMenu);

    private final JPanel requestDetailPanel = new RoundedPanel(new BorderLayout(0, JBUI.scale(8)), 8, SURFACE_ALT, false);
    private final CardLayout requestContentLayout = new CardLayout();
    private final JPanel requestContentDeck = new JPanel(requestContentLayout);
    private final JBLabel requestDetailTitle = new JBLabel("请求详情");
    private final JBLabel requestDetailMeta = mutedLabel("选择一条请求查看 Token 拆分与性能");
    private final JBLabel requestInput = factValue();
    private final JBLabel requestOutput = factValue();
    private final JBLabel requestReasoning = factValue();
    private final JBLabel requestCache = factValue();
    private final JBLabel requestTtft = factValue();
    private final JBLabel requestFirstContent = factValue();
    private final JBLabel requestSpeed = factValue();
    private final JBLabel requestError = mutedLabel("");

    private final JBLabel diagnosticTitle = new JBLabel("正在检查本地数据");
    private final JBLabel diagnosticMeta = mutedLabel("读取完成后会显示数据库与性能摘要");
    private final JBTextArea diagnostics = new JBTextArea();

    private final Timer searchTimer;
    private final AtomicLong analyticsQueryGeneration = new AtomicLong();
    private final AtomicLong sessionQueryGeneration = new AtomicLong();
    private final AtomicLong requestQueryGeneration = new AtomicLong();
    private final AtomicLong filterQueryGeneration = new AtomicLong();
    private final AtomicLong diagnosticsQueryGeneration = new AtomicLong();
    private final QueryDisplayState analyticsDisplay = new QueryDisplayState();
    private final QueryDisplayState sessionDisplay = new QueryDisplayState();

    private AutoCloseable subscription;
    private Future<?> analyticsQueryTask;
    private Future<?> sessionQueryTask;
    private Future<?> requestQueryTask;
    private Future<?> filterQueryTask;
    private Future<?> diagnosticsQueryTask;
    private UsageSnapshot current = UsageSnapshot.empty("等待首次刷新");
    private List<UsageSnapshot.SessionInfo> sessionRows = List.of();
    private List<UsageSnapshot.RequestInfo> requestRows = List.of();
    private int sessionPage = 1;
    private int sessionPageCount = 1;
    private int requestPage = 1;
    private int requestPageCount = 1;
    private String selectedSessionId = "";
    private String selectedSessionSource = "";
    private String selectedSessionDirectory = "";
    private String selectedSessionTitle = "";
    private String selectedRequestKey = "";
    private boolean requestDetailVisible;
    private String activeView = VIEW_ANALYTICS;
    private boolean sessionsDirty = true;
    private boolean requestsDirty = true;
    private boolean hasRenderedData;
    private boolean hasRenderedAnalytics;
    private boolean disposed;
    private boolean changingUsageRange;
    private boolean changingSessionRange;
    private AnalyticsRange appliedUsageRange;
    private AnalyticsRange appliedSessionRange;
    private String displayedDataSource = "";
    private boolean loadingFilterOptions;

    CodeArtsDashboardPanel(Project project) {
        super(true, true);
        this.project = project;
        setBackground(CANVAS);
        CodeArtsSettings.State settings = CodeArtsSettings.getInstance().getState();
        appliedUsageRange = AnalyticsRange.fromId(settings.analyticsRange);
        appliedSessionRange = AnalyticsRange.fromId(settings.sessionRange);
        ensureCustomRangeDefaults(settings, true);
        ensureCustomRangeDefaults(settings, false);
        usageRange.setSelectedItem(appliedUsageRange);
        sessionProject.addItem(new UsageSnapshot.ProjectInfo("", "", 0));
        sessionTimeRange.setSelectedItem(appliedSessionRange);
        configureAccessibility();
        updateRangeDescriptions();
        searchTimer = new Timer(280, event -> startNewSearch());
        searchTimer.setRepeats(false);
        configureTables();
        configureInteractions();
        setContent(content());
        setToolbar(toolbar());
        allowNarrow(this);
        activateDataSubscription();
    }

    private void configureAccessibility() {
        usageRange.getAccessibleContext().setAccessibleName("Token 时间范围");
        usageRange.getAccessibleContext().setAccessibleDescription("筛选所有使用分析指标的时间范围");
        sessionSearch.getTextEditor().getAccessibleContext().setAccessibleName("搜索会话");
        sessionSource.getAccessibleContext().setAccessibleName("会话来源");
        sessionModel.getAccessibleContext().setAccessibleName("会话模型筛选");
        sessionTimeRange.getAccessibleContext().setAccessibleName("会话时间范围");
        modelGrid.getAccessibleContext().setAccessibleName("模型用量表");
        sourceGrid.getAccessibleContext().setAccessibleName("数据源用量表");
        providerGrid.getAccessibleContext().setAccessibleName("Provider 用量表");
        analyticsModel.getAccessibleContext().setAccessibleName("分析模型筛选");
        analyticsSource.getAccessibleContext().setAccessibleName("分析来源筛选");
        sessionProject.getAccessibleContext().setAccessibleName("会话项目筛选");
        sessionGrid.getAccessibleContext().setAccessibleName("会话列表");
        requestGrid.getAccessibleContext().setAccessibleName("请求列表");
        diagnostics.getAccessibleContext().setAccessibleName("脱敏诊断报告");
    }

    private void configureTables() {
        installRichRenderer(modelGrid, 0);
        installNumberRenderer(modelGrid, 1, value -> tokens(value.longValue()));
        installNumberRenderer(modelGrid, 2, value -> number(value.longValue()));
        installRightRenderer(modelGrid, 3);
        setColumnWidths(modelGrid, 150, 76, 58, 66);

        installRichRenderer(sourceGrid, 0);
        installNumberRenderer(sourceGrid, 1, value -> tokens(value.longValue()));
        installNumberRenderer(sourceGrid, 2, value -> number(value.longValue()));
        installNumberRenderer(sourceGrid, 3, value -> number(value.longValue()));
        setColumnWidths(sourceGrid, 150, 76, 58, 56);

        installRichRenderer(providerGrid, 0);
        installNumberRenderer(providerGrid, 1, value -> tokens(value.longValue()));
        installNumberRenderer(providerGrid, 2, value -> number(value.longValue()));
        installNumberRenderer(providerGrid, 3, value -> number(value.longValue()));
        setColumnWidths(providerGrid, 150, 76, 58, 56);

        sessionGrid.setAutoCreateRowSorter(false);
        sessionGrid.setRowSorter(null);
        installRichRenderer(sessionGrid, 0);
        installNumberRenderer(sessionGrid, 1, value -> tokens(value.longValue()));
        installRightRenderer(sessionGrid, 2);
        setColumnWidths(sessionGrid, 170, 68, 92);

        requestGrid.setAutoCreateRowSorter(false);
        requestGrid.setRowSorter(null);
        requestGrid.setRowHeight(JBUI.scale(42));
        installRichRenderer(requestGrid, 0);
        installNumberRenderer(requestGrid, 1, value -> tokens(value.longValue()));
        installRightRenderer(requestGrid, 2);
        installRightRenderer(requestGrid, 3);
        setColumnWidths(requestGrid, 145, 64, 64, 50);
    }

    private void configureInteractions() {
        usageRange.addActionListener(event -> {
            if (changingUsageRange) return;
            AnalyticsRange range = selectedAnalyticsRange();
            if (range.custom()) {
                usageRange.hidePopup();
                SwingUtilities.invokeLater(() -> finishCustomRangeSelection(range));
                return;
            }
            applyUsageRange(range);
        });
        installCustomRangeReopen(usageRange, () -> finishCustomRangeSelection(AnalyticsRange.CUSTOM));
        sessionGrid.getSelectionModel().addListSelectionListener(event -> {
            if (!event.getValueIsAdjusting()) selectSession();
        });
        requestGrid.getSelectionModel().addListSelectionListener(event -> {
            if (!event.getValueIsAdjusting()) selectRequest();
        });

        sessionSearch.getTextEditor().putClientProperty("JTextField.placeholderText", "搜索会话标题、目录或 ID");
        sessionSearch.getTextEditor().addActionListener(event -> startNewSearch());
        sessionSearch.getTextEditor().getDocument().addDocumentListener(new DocumentListener() {
            @Override public void insertUpdate(DocumentEvent event) { scheduleSearch(); }
            @Override public void removeUpdate(DocumentEvent event) { scheduleSearch(); }
            @Override public void changedUpdate(DocumentEvent event) { scheduleSearch(); }
        });
        sessionSource.addActionListener(event -> startNewSearch());
        sessionModel.addActionListener(event -> { if (!loadingFilterOptions) startNewSearch(); });
        sessionProject.addActionListener(event -> { if (!loadingFilterOptions) startNewSearch(); });
        analyticsModel.addActionListener(event -> { if (!loadingFilterOptions) loadAnalyticsRange(); });
        analyticsSource.addActionListener(event -> loadAnalyticsRange());
        sessionTimeRange.addActionListener(event -> {
            if (changingSessionRange) return;
            AnalyticsRange range = selectedSessionRange();
            if (range.custom()) {
                sessionTimeRange.hidePopup();
                SwingUtilities.invokeLater(() -> finishCustomSessionRangeSelection(range));
                return;
            }
            applySessionRange(range);
        });
        installCustomRangeReopen(sessionTimeRange,
                () -> finishCustomSessionRangeSelection(AnalyticsRange.CUSTOM));

        previousSessions.addActionListener(event -> {
            if (sessionPage > 1) {
                clearSelectedSessionState();
                sessionPage--;
                loadSessionPage();
            }
        });
        nextSessions.addActionListener(event -> {
            if (sessionPage < sessionPageCount) {
                clearSelectedSessionState();
                sessionPage++;
                loadSessionPage();
            }
        });
        previousRequests.addActionListener(event -> {
            if (requestPage > 1) { requestPage--; loadRequestPage(false); }
        });
        nextRequests.addActionListener(event -> {
            if (requestPage < requestPageCount) { requestPage++; loadRequestPage(false); }
        });

        openSessionFolder.setEnabled(false);
        copySessionId.setEnabled(false);
        exportSessionButton.setEnabled(false);
        updatePagerButtons();
    }

    private JComponent toolbar() {
        JPanel panel = transparent();
        panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
        panel.setOpaque(true);
        panel.setBackground(CANVAS);
        panel.setBorder(JBUI.Borders.empty(7, 10, 8, 10));

        JPanel actionRow = transparent(new BorderLayout(JBUI.scale(8), 0));
        actionRow.setAlignmentX(Component.LEFT_ALIGNMENT);
        refreshState.setForeground(MUTED);
        refreshState.setFont(refreshState.getFont().deriveFont(11f));
        actionRow.add(refreshState, BorderLayout.CENTER);

        JPanel actions = transparent(new FlowLayout(FlowLayout.RIGHT, JBUI.scale(2), 0));
        actions.add(iconButton("刷新", AllIcons.Actions.Refresh, () -> {
            refreshState.setText("正在刷新...");
            refreshState.setForeground(MUTED);
            service.refresh(true);
        }));
        actions.add(iconButton("设置", AllIcons.General.Settings, () -> openSettings()));
        actions.add(iconButton("打开数据目录", AllIcons.Nodes.Folder, OpenDataFolderAction::openFolder));
        actionRow.add(actions, BorderLayout.EAST);
        panel.add(actionRow);
        panel.add(Box.createVerticalStrut(JBUI.scale(5)));

        ButtonGroup group = new ButtonGroup();
        group.add(analyticsViewButton);
        group.add(sessionsViewButton);
        group.add(diagnosticsViewButton);
        JPanel navigation = segmentedBar(analyticsViewButton, sessionsViewButton, diagnosticsViewButton);
        navigation.setPreferredSize(new Dimension(JBUI.scale(360), JBUI.scale(34)));
        navigation.setMaximumSize(new Dimension(JBUI.scale(480), JBUI.scale(34)));
        navigation.setMinimumSize(new Dimension(0, JBUI.scale(34)));
        JPanel navigationRow = transparent();
        navigationRow.setLayout(new BoxLayout(navigationRow, BoxLayout.X_AXIS));
        navigationRow.add(Box.createHorizontalGlue());
        navigationRow.add(navigation);
        navigationRow.add(Box.createHorizontalGlue());
        navigationRow.setAlignmentX(Component.LEFT_ALIGNMENT);
        navigationRow.setMaximumSize(new Dimension(Integer.MAX_VALUE, JBUI.scale(34)));
        panel.add(navigationRow);
        return panel;
    }

    private JComponent content() {
        viewDeck.setOpaque(true);
        viewDeck.setBackground(CANVAS);
        viewDeck.add(overview(), VIEW_ANALYTICS);
        viewDeck.add(sessionsPanel(), VIEW_SESSIONS);
        viewDeck.add(diagnosticsPanel(), VIEW_DIAGNOSTICS);
        return viewDeck;
    }

    private JComponent overview() {
        ScrollablePanel body = new ScrollablePanel();
        body.setBorder(JBUI.Borders.empty(14));

        usageRange.setPreferredSize(new Dimension(JBUI.scale(132), usageRange.getPreferredSize().height));
        ResponsiveHeader heading = new ResponsiveHeader(
                sectionHeader("使用分析", "快速确认 Token、缓存和模型趋势", null), usageRange);
        stretch(heading);
        body.add(heading);
        body.add(Box.createVerticalStrut(JBUI.scale(16)));

        overviewStateDeck.setOpaque(false);
        overviewStateDeck.add(analyticsDataPanel(), "data");
        overviewStateDeck.add(statePanel("正在读取本地数据", "正在分析本地 SQLite 数据，不会上传会话内容。", null), "loading");
        overviewStateDeck.add(statePanel("还没有可显示的用量", "确认数据库路径后刷新，或先在 CodeArts Agent 中完成一次请求。",
                button("打开设置", this::openSettings)), "empty");
        JPanel errorActions = transparent(new FlowLayout(FlowLayout.CENTER, JBUI.scale(8), 0));
        errorActions.add(button("重试", () -> service.refresh(true)));
        errorActions.add(button("查看诊断", () -> showView(VIEW_DIAGNOSTICS)));
        errorActions.add(button("检查设置", this::openSettings));
        overviewStateDeck.add(statePanel("本地数据读取失败", overviewErrorDescription, errorActions), "error");
        JPanel analyticsErrorActions = transparent(new FlowLayout(FlowLayout.CENTER, JBUI.scale(8), 0));
        analyticsErrorActions.add(button("重试", this::loadAnalyticsRange));
        analyticsErrorActions.add(button("检查设置", this::openSettings));
        overviewStateDeck.add(statePanel("时间范围加载失败", "基础数据仍然可用，请重试当前范围；如果持续失败，再检查 CLI 与数据库设置。",
                analyticsErrorActions), "analyticsError");
        overviewStateDeck.setAlignmentX(Component.LEFT_ALIGNMENT);
        overviewStateDeck.setMaximumSize(new Dimension(Integer.MAX_VALUE, Integer.MAX_VALUE));
        body.add(overviewStateDeck);

        JBScrollPane scroll = new JBScrollPane(body);
        scroll.setBorder(null);
        scroll.getViewport().setBackground(CANVAS);
        scroll.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
        scroll.getVerticalScrollBar().setUnitIncrement(JBUI.scale(16));
        return scroll;
    }

    private JPanel analyticsDataPanel() {
        JPanel body = transparent();
        body.setLayout(new BoxLayout(body, BoxLayout.Y_AXIS));

        stretch(usageHero);
        body.add(usageHero);
        body.add(Box.createVerticalStrut(JBUI.scale(8)));

        JPanel metrics = groupedGrid(2, 2, inputMetric, outputMetric, cacheWriteMetric, cacheReadMetric);
        stretch(metrics);
        body.add(metrics);
        body.add(Box.createVerticalStrut(JBUI.scale(10)));

        JPanel analyticsFilters = transparent(new FlowLayout(FlowLayout.LEFT, JBUI.scale(6), 0));
        analyticsModel.setPreferredSize(new Dimension(JBUI.scale(180), analyticsModel.getPreferredSize().height));
        analyticsFilters.add(new JBLabel("模型"));
        analyticsFilters.add(analyticsModel);
        analyticsFilters.add(new JBLabel("来源"));
        analyticsFilters.add(analyticsSource);
        body.add(analyticsFilters);
        body.add(Box.createVerticalStrut(JBUI.scale(10)));

        JPanel cacheCard = progressCard("缓存命中率", cacheRateValue, cacheProgress, cacheRateMeta);
        JPanel quotaCard = progressCard("每日软上限", quotaValue, quotaProgress, quotaMeta);
        quotaCard.remove(quotaMeta);
        JPanel quotaFooter = transparent(new BorderLayout(JBUI.scale(8), 0));
        quotaFooter.add(quotaMeta, BorderLayout.CENTER);
        quotaFooter.add(health, BorderLayout.EAST);
        quotaCard.add(quotaFooter, BorderLayout.SOUTH);
        JPanel progressGroup = groupedGrid(2, 1, cacheCard, quotaCard);
        stretch(progressGroup);
        body.add(progressGroup);
        body.add(Box.createVerticalStrut(JBUI.scale(16)));

        RoundedPanel trendCard = new RoundedPanel(new BorderLayout(0, JBUI.scale(8)), 10, SURFACE);
        trendCard.setBorder(JBUI.Borders.empty(14));
        JPanel trendHeader = sectionHeader("使用趋势", "总 Token、输入、输出与缓存命中", null);
        trendCard.add(trendHeader, BorderLayout.NORTH);
        trendCard.add(chart, BorderLayout.CENTER);
        trendCard.setPreferredSize(new Dimension(0, JBUI.scale(336)));
        stretch(trendCard);
        body.add(trendCard);
        body.add(Box.createVerticalStrut(JBUI.scale(16)));

        JComponent details = detailsPanel();
        stretch(details);
        body.add(details);
        return body;
    }

    private JComponent detailsPanel() {
        RoundedPanel root = new RoundedPanel(new BorderLayout(0, JBUI.scale(8)), 10, SURFACE);
        root.setBorder(JBUI.Borders.empty(14));

        CardLayout layout = new CardLayout();
        JPanel deck = new JPanel(layout);
        deck.setOpaque(false);
        deck.add(tableSurface(modelGrid), "models");
        deck.add(tableSurface(providerGrid), "providers");
        deck.add(tableSurface(sourceGrid), "sources");

        ButtonGroup group = new ButtonGroup();
        ViewToggleButton models = viewButton("模型", true, () -> layout.show(deck, "models"));
        ViewToggleButton providers = viewButton("Provider", false, () -> layout.show(deck, "providers"));
        ViewToggleButton sources = viewButton("数据源", false, () -> layout.show(deck, "sources"));
        group.add(models);
        group.add(providers);
        group.add(sources);
        JPanel switcher = segmentedBar(models, providers, sources);
        switcher.setPreferredSize(new Dimension(JBUI.scale(230), JBUI.scale(34)));

        root.add(sectionHeader("模型与来源", "用于定位主要消耗和异常来源", switcher), BorderLayout.NORTH);
        root.add(deck, BorderLayout.CENTER);
        root.setPreferredSize(new Dimension(0, JBUI.scale(312)));
        return root;
    }

    private JComponent sessionsPanel() {
        JPanel root = transparent(new BorderLayout(0, JBUI.scale(10)));
        root.setBorder(JBUI.Borders.empty(14));

        sessionSummary.setForeground(MUTED);
        JPanel title = sectionHeader("会话管理", "插件支持查看和导出；重命名、归档等写操作请在 Desktop 中完成", sessionSummary);
        root.add(title, BorderLayout.NORTH);

        RoundedPanel sessionArea = new RoundedPanel(new BorderLayout(0, JBUI.scale(7)), 10, SURFACE);
        sessionArea.setBorder(JBUI.Borders.empty(9));
        JPanel filters = transparent(new BorderLayout(JBUI.scale(6), 0));
        filters.add(sessionSearch, BorderLayout.CENTER);
        sessionSource.setPreferredSize(new Dimension(JBUI.scale(92), sessionSource.getPreferredSize().height));
        sessionModel.setPreferredSize(new Dimension(JBUI.scale(132), sessionModel.getPreferredSize().height));
        sessionProject.setPreferredSize(new Dimension(JBUI.scale(132), sessionProject.getPreferredSize().height));
        sessionTimeRange.setPreferredSize(new Dimension(JBUI.scale(112), sessionTimeRange.getPreferredSize().height));
        JPanel filterMenus = transparent(new GridLayout(1, 4, JBUI.scale(6), 0));
        filterMenus.add(sessionTimeRange);
        filterMenus.add(sessionSource);
        filterMenus.add(sessionModel);
        filterMenus.add(sessionProject);
        filters.add(filterMenus, BorderLayout.EAST);
        filters.addComponentListener(new ComponentAdapter() {
            private boolean stacked;
            @Override public void componentResized(ComponentEvent event) {
                boolean next = filters.getWidth() < JBUI.scale(430);
                if (next == stacked) return;
                stacked = next;
                filters.removeAll();
                if (stacked) {
                    filters.setLayout(new BorderLayout(0, JBUI.scale(6)));
                    filters.add(sessionSearch, BorderLayout.NORTH);
                    filters.add(filterMenus, BorderLayout.CENTER);
                } else {
                    filters.setLayout(new BorderLayout(JBUI.scale(6), 0));
                    filters.add(sessionSearch, BorderLayout.CENTER);
                    filters.add(filterMenus, BorderLayout.EAST);
                }
                filters.revalidate();
            }
        });
        sessionArea.add(filters, BorderLayout.NORTH);
        sessionArea.add(tableSurface(sessionGrid), BorderLayout.CENTER);
        sessionArea.add(pager(previousSessions, sessionPageLabel, nextSessions), BorderLayout.SOUTH);

        RoundedPanel requestArea = new RoundedPanel(new BorderLayout(0, JBUI.scale(7)), 10, SURFACE);
        requestArea.setBorder(JBUI.Borders.empty(9));
        JPanel inspectorTop = transparent();
        inspectorTop.setLayout(new BoxLayout(inspectorTop, BoxLayout.Y_AXIS));
        stretch(sessionInspector);
        inspectorTop.add(sessionInspector);
        inspectorTop.add(Box.createVerticalStrut(JBUI.scale(6)));
        JPanel inspectorActions = transparent(new FlowLayout(FlowLayout.RIGHT, JBUI.scale(6), 0));
        inspectorActions.add(openSessionFolder);
        inspectorActions.add(copySessionId);
        inspectorActions.add(exportSessionButton);
        stretch(inspectorActions);
        inspectorTop.add(inspectorActions);
        requestArea.add(inspectorTop, BorderLayout.NORTH);
        buildRequestDetailPanel();
        JPanel requestList = transparent(new BorderLayout(0, JBUI.scale(6)));
        requestList.add(tableSurface(requestGrid), BorderLayout.CENTER);
        requestList.add(pager(previousRequests, requestPageLabel, nextRequests), BorderLayout.SOUTH);
        requestContentDeck.setOpaque(false);
        requestContentDeck.add(requestList, "list");
        requestContentDeck.add(requestDetailPanel, "detail");
        requestArea.add(requestContentDeck, BorderLayout.CENTER);

        AdaptiveSplitPane split = new AdaptiveSplitPane(sessionArea, requestArea);
        split.setOpaque(false);
        root.add(split, BorderLayout.CENTER);
        return root;
    }

    private JComponent diagnosticsPanel() {
        ScrollablePanel body = new ScrollablePanel();
        body.setBorder(JBUI.Borders.empty(14));

        JPanel header = sectionHeader("诊断", "检查数据库、适配器和响应性能", null);
        stretch(header);
        body.add(header);
        body.add(Box.createVerticalStrut(JBUI.scale(12)));

        RoundedPanel banner = new RoundedPanel(new BorderLayout(JBUI.scale(8), 0), 10, SURFACE);
        banner.setBorder(JBUI.Borders.empty(12));
        JPanel copy = transparent();
        copy.setLayout(new BoxLayout(copy, BoxLayout.Y_AXIS));
        diagnosticTitle.setFont(diagnosticTitle.getFont().deriveFont(Font.BOLD, 14f));
        copy.add(diagnosticTitle);
        copy.add(Box.createVerticalStrut(JBUI.scale(3)));
        copy.add(diagnosticMeta);
        banner.add(copy, BorderLayout.CENTER);
        stretch(banner);
        body.add(banner);
        body.add(Box.createVerticalStrut(JBUI.scale(8)));

        JPanel actions = transparent(new FlowLayout(FlowLayout.LEFT, JBUI.scale(6), 0));
        actions.add(button("重试", () -> service.refresh(true)));
        actions.add(button("设置", this::openSettings));
        actions.add(button("数据目录", OpenDataFolderAction::openFolder));
        actions.add(button("复制报告", this::copyDiagnostics));
        stretch(actions);
        body.add(actions);
        body.add(Box.createVerticalStrut(JBUI.scale(12)));

        JPanel metrics = groupedGrid(2, 2, diagnosticDatabaseMetric, diagnosticLatencyMetric,
                diagnosticErrorMetric, diagnosticSessionMetric);
        stretch(metrics);
        body.add(metrics);
        body.add(Box.createVerticalStrut(JBUI.scale(12)));

        diagnostics.setEditable(false);
        diagnostics.setLineWrap(true);
        diagnostics.setWrapStyleWord(true);
        diagnostics.setBackground(SURFACE_ALT);
        diagnostics.setFont(new Font(Font.MONOSPACED, Font.PLAIN, diagnostics.getFont().getSize()));
        diagnostics.setBorder(JBUI.Borders.empty(10));
        RoundedPanel report = new RoundedPanel(new BorderLayout(0, JBUI.scale(7)), 10, SURFACE);
        report.setBorder(JBUI.Borders.empty(10));
        JBLabel reportTitle = new JBLabel("技术详情（已脱敏）");
        reportTitle.setFont(reportTitle.getFont().deriveFont(Font.BOLD, 12f));
        report.add(reportTitle, BorderLayout.NORTH);
        JBScrollPane reportScroll = new JBScrollPane(diagnostics);
        reportScroll.setBorder(JBUI.Borders.empty());
        report.add(reportScroll, BorderLayout.CENTER);
        report.setPreferredSize(new Dimension(0, JBUI.scale(360)));
        stretch(report);
        body.add(report);

        JBScrollPane scroll = new JBScrollPane(body);
        scroll.setBorder(null);
        scroll.getViewport().setBackground(CANVAS);
        scroll.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
        scroll.getVerticalScrollBar().setUnitIncrement(JBUI.scale(16));
        return scroll;
    }

    private void showView(String view) {
        analyticsViewButton.setSelected(VIEW_ANALYTICS.equals(view));
        sessionsViewButton.setSelected(VIEW_SESSIONS.equals(view));
        diagnosticsViewButton.setSelected(VIEW_DIAGNOSTICS.equals(view));
        if (view.equals(activeView)) return;
        activeView = view;
        viewLayout.show(viewDeck, view);
        if (VIEW_SESSIONS.equals(view)) {
            if (sessionsDirty) loadSessionPage();
            else if (!selectedSessionId.isBlank() && requestsDirty) loadRequestPage(false);
        }
        if (VIEW_DIAGNOSTICS.equals(view)) loadDatabaseDiagnostics();
    }

    private void render(UsageSnapshot snapshot) {
        if (disposed) return;
        current = snapshot;
        if (!snapshot.ok()) {
            String configuredDatabase = CodeArtsSettings.getInstance().getState().dbPath;
            if (DataSourceIdentity.changed(displayedDataSource, configuredDatabase)) clearDisplayedDataSource();
            renderReadFailure(snapshot.error());
            return;
        }

        String nextDataSource = snapshot.adapter();
        if (!displayedDataSource.isBlank() && !displayedDataSource.equals(nextDataSource)) {
            clearDisplayedDataSource();
        }
        displayedDataSource = nextDataSource;

        hasRenderedData = true;
        refreshState.setForeground(MUTED);
        refreshState.setText("已更新 " + snapshot.updatedAt());
        refreshState.setToolTipText("数据适配器：" + snapshot.adapter());

        int usagePercentage = (int) Math.max(0, Math.min(100, Math.round(snapshot.usagePercent())));
        quotaProgress.setValue(usagePercentage);
        quotaValue.setText(usagePercentage + "%");
        quotaMeta.setText(tokens(snapshot.quota().used())
                + (snapshot.quota().limit() == null ? " · 未设置显示上限" : " / " + tokens(snapshot.quota().limit())));
        boolean healthy = snapshot.health().issues().isEmpty();
        health.setText((healthy ? "● " : "! ") + empty(snapshot.health().label(), healthy ? "正常" : "需检查"));
        health.setForeground(healthy ? SUCCESS : CACHE_WRITE);
        health.setToolTipText(empty(snapshot.health().message(), "本地数据可用"));

        sessionSummary.setText(number(snapshot.sessionTotal()) + " 个 · 活跃 " + number(snapshot.sessionActive()));
        renderDiagnostics(snapshot);

        boolean emptySnapshot = snapshot.all().total() == 0
                && snapshot.sessionTotal() == 0 && snapshot.models().isEmpty();
        showOverviewState(emptySnapshot ? "empty" : hasRenderedAnalytics ? "data" : "loading");

        sessionsDirty = true;
        requestsDirty = true;
        if (VIEW_SESSIONS.equals(activeView)) loadSessionPage();
        if (VIEW_DIAGNOSTICS.equals(activeView)) loadDatabaseDiagnostics();
        loadFilterOptions();
        loadAnalyticsRange();
    }

    private void renderReadFailure(String message) {
        if (!hasRenderedData && service.isRefreshing()) {
            refreshState.setText("正在读取本地数据...");
            showOverviewState("loading");
            return;
        }

        String error = empty(message, "未知错误");
        overviewErrorDescription.setText(error + "\n请检查 Node.js、CLI 与数据库路径，然后重试。");
        overviewErrorDescription.setCaretPosition(0);
        refreshState.setForeground(DANGER);
        diagnosticTitle.setText("数据读取失败");
        diagnosticTitle.setForeground(DANGER);
        diagnosticMeta.setText(error);
        diagnostics.setText("读取失败\n" + error + "\n\n请检查 Node.js、CLI 与数据库路径，然后重试。");
        diagnostics.setCaretPosition(0);
        if (hasRenderedData) {
            refreshState.setText("刷新失败，正在显示上次数据");
            refreshState.setToolTipText(error);
        } else {
            refreshState.setText("读取失败，打开诊断查看详情");
            showOverviewState("error");
        }
    }

    private void showOverviewState(String state) {
        overviewStateLayout.show(overviewStateDeck, state);
        overviewStateDeck.revalidate();
        overviewStateDeck.repaint();
    }

    private void clearDisplayedDataSource() {
        analyticsQueryGeneration.incrementAndGet();
        sessionQueryGeneration.incrementAndGet();
        requestQueryGeneration.incrementAndGet();
        filterQueryGeneration.incrementAndGet();
        diagnosticsQueryGeneration.incrementAndGet();
        cancelQuery(analyticsQueryTask);
        cancelQuery(sessionQueryTask);
        cancelQuery(requestQueryTask);
        cancelQuery(filterQueryTask);
        cancelQuery(diagnosticsQueryTask);
        displayedDataSource = "";
        hasRenderedData = false;
        hasRenderedAnalytics = false;
        analyticsDisplay.reset();
        sessionDisplay.reset();
        clear(modelTable);
        clear(sourceTable);
        sessionRows = List.of();
        clear(sessionTable);
        sessionPage = 1;
        sessionPageCount = 1;
        clearSelectedSessionState();
        sessionGrid.getEmptyText().setText("等待新数据库加载");
        sessionPageLabel.setText("等待新数据库加载");
        sessionsDirty = true;
        showOverviewState("loading");
    }

    private void startNewSearch() {
        searchTimer.stop();
        sessionPage = 1;
        clearSelectedSessionState();
        loadSessionPage();
    }

    private void scheduleSearch() {
        sessionQueryGeneration.incrementAndGet();
        sessionPageLabel.setText("输入完成后自动搜索...");
        searchTimer.restart();
    }

    private void loadSessionPage() {
        long generation = sessionQueryGeneration.incrementAndGet();
        cancelQuery(sessionQueryTask);
        boolean hasVisibleRows = sessionTable.getRowCount() > 0;
        sessionGrid.setEnabled(hasVisibleRows);
        sessionGrid.getEmptyText().setText("正在加载会话...");
        sessionPageLabel.setText(sessionTable.getRowCount() == 0 ? "正在加载第 " + sessionPage + " 页..." : "正在更新...");
        previousSessions.setEnabled(false);
        nextSessions.setEnabled(false);

        List<String> args = new ArrayList<>(List.of(
                "--page", Integer.toString(sessionPage),
                "--page-size", Integer.toString(SESSION_PAGE_SIZE)));
        String query = sessionSearch.getText().trim();
        if (!query.isEmpty()) args.addAll(List.of("--search", query));
        String source = selectedSourceId();
        if (!source.isBlank()) args.addAll(List.of("--source", source));
        Object modelFilter = sessionModel.getSelectedItem();
        if (sessionModel.getSelectedIndex() > 0 && modelFilter != null) args.addAll(List.of("--model", modelFilter.toString()));
        UsageSnapshot.ProjectInfo projectFilter = (UsageSnapshot.ProjectInfo) sessionProject.getSelectedItem();
        if (projectFilter != null && !projectFilter.id().isBlank()) args.addAll(List.of("--project", projectFilter.id()));
        appendSessionRangeArgs(args);
        String queryLabel = sessionQueryLabel(query);

        sessionQueryTask = service.query("sessions", args, data -> {
            if (disposed || generation != sessionQueryGeneration.get()) return;
            int returnedPageCount = Math.max(1, intValue(data, "pageCount", 1));
            if (sessionPage > returnedPageCount) {
                sessionPage = returnedPageCount;
                loadSessionPage();
                return;
            }
            sessionPageCount = returnedPageCount;
            sessionRows = UsageSnapshot.sessionItems(data);
            fillSessions(sessionRows);
            sessionGrid.setEnabled(true);
            sessionsDirty = false;
            sessionDisplay.markSuccess(queryLabel);
            int total = intValue(data, "total", 0);
            sessionGrid.getEmptyText().setText(query.isBlank() ? "暂无会话" : "没有匹配的会话");
            sessionPageLabel.setText(total == 0 ? "没有匹配的会话" : sessionPage + " / " + sessionPageCount + " · " + total + " 个");
            if (!selectedSessionId.isBlank() && !restoreSessionSelection()) clearSelectedSessionState();
            updatePagerButtons();
            if (!selectedSessionId.isBlank() && requestsDirty) loadRequestPage(false);
        }, message -> {
            if (disposed || generation != sessionQueryGeneration.get()) return;
            showQueryError(sessionDisplay.failure(queryLabel, message));
            sessionGrid.getEmptyText().setText("会话加载失败，请重试");
            sessionGrid.setEnabled(true);
            updatePagerButtons();
        });
    }

    private void selectSession() {
        int viewRow = sessionGrid.getSelectedRow();
        if (viewRow < 0) return;
        int modelRow = sessionGrid.convertRowIndexToModel(viewRow);
        if (modelRow < 0 || modelRow >= sessionRows.size()) return;
        UsageSnapshot.SessionInfo row = sessionRows.get(modelRow);
        if (row.id().equals(selectedSessionId) && row.source().equals(selectedSessionSource)) return;

        selectedSessionId = row.id();
        selectedSessionSource = row.source();
        selectedSessionDirectory = row.directory();
        selectedSessionTitle = safeText(empty(row.title(), "无标题会话"));
        sessionInspector.setSession(safeText(empty(row.title(), "无标题会话")),
                sourceLabel(row.source()) + " · " + empty(row.model(), "未识别模型") + " · " + date(row.updatedAt()),
                tokens(row.total()), number(row.requests()), null);
        openSessionFolder.setEnabled(!selectedSessionDirectory.isBlank() && new File(selectedSessionDirectory).isDirectory());
        copySessionId.setEnabled(!selectedSessionId.isBlank());
        exportSessionButton.setEnabled(!selectedSessionId.isBlank());

        requestPage = 1;
        requestsDirty = true;
        requestRows = List.of();
        clear(requestTable);
        requestGrid.getEmptyText().setText("正在加载请求...");
        clearSelectedRequestState();
        loadRequestPage(true);
    }

    private boolean restoreSessionSelection() {
        if (selectedSessionId.isBlank()) return false;
        for (int modelRow = 0; modelRow < sessionRows.size(); modelRow++) {
            UsageSnapshot.SessionInfo row = sessionRows.get(modelRow);
            if (selectedSessionId.equals(row.id()) && selectedSessionSource.equals(row.source())) {
                int viewRow = sessionGrid.convertRowIndexToView(modelRow);
                if (viewRow >= 0) {
                    sessionGrid.getSelectionModel().setSelectionInterval(viewRow, viewRow);
                    return true;
                }
                return false;
            }
        }
        return false;
    }

    private void clearSelectedSessionState() {
        selectedSessionId = "";
        selectedSessionSource = "";
        selectedSessionDirectory = "";
        selectedSessionTitle = "";
        sessionGrid.clearSelection();
        sessionInspector.setEmpty();
        openSessionFolder.setEnabled(false);
        copySessionId.setEnabled(false);
        exportSessionButton.setEnabled(false);
        requestQueryGeneration.incrementAndGet();
        cancelQuery(requestQueryTask);
        requestRows = List.of();
        requestPage = 1;
        requestPageCount = 1;
        requestsDirty = true;
        clear(requestTable);
        requestGrid.getEmptyText().setText("选择会话后查看请求");
        requestPageLabel.setText("请选择一个会话");
        clearSelectedRequestState();
        updatePagerButtons();
    }

    private void loadRequestPage(boolean clearForNewSession) {
        if (selectedSessionId.isBlank()) return;
        String sessionId = selectedSessionId;
        String source = selectedSessionSource;
        long generation = requestQueryGeneration.incrementAndGet();
        cancelQuery(requestQueryTask);
        boolean hasVisibleRows = requestTable.getRowCount() > 0;
        requestGrid.setEnabled(hasVisibleRows && !clearForNewSession);
        if (clearForNewSession) requestGrid.getEmptyText().setText("正在加载请求...");
        requestPageLabel.setText(requestTable.getRowCount() == 0 ? "正在加载请求..." : "正在更新...");
        previousRequests.setEnabled(false);
        nextRequests.setEnabled(false);

        List<String> args = new ArrayList<>(List.of(
                "--session-id", sessionId,
                "--source", source,
                "--page", Integer.toString(requestPage),
                "--page-size", Integer.toString(REQUEST_PAGE_SIZE)));
        appendSessionRangeArgs(args);
        requestQueryTask = service.query("requests", args, data -> {
            if (disposed || generation != requestQueryGeneration.get()
                    || !sessionId.equals(selectedSessionId)
                    || !source.equals(selectedSessionSource)) return;
            int returnedPageCount = Math.max(1, intValue(data, "pageCount", 1));
            if (requestPage > returnedPageCount) {
                requestPage = returnedPageCount;
                loadRequestPage(false);
                return;
            }
            requestPageCount = returnedPageCount;
            requestRows = UsageSnapshot.requestItems(data);
            fillRequests(requestRows);
            if (requestDetailVisible && !restoreRequestSelection()) clearSelectedRequestState();
            requestGrid.setEnabled(true);
            requestsDirty = false;
            int total = intValue(data, "total", 0);
            requestGrid.getEmptyText().setText("该会话暂无请求");
            requestPageLabel.setText(total == 0 ? "该会话暂无请求" : requestPage + " / " + requestPageCount + " · " + total + " 个");
            updatePagerButtons();
        }, message -> {
            if (disposed || generation != requestQueryGeneration.get() || !sessionId.equals(selectedSessionId)) return;
            showQueryError("请求加载失败：" + message);
            requestGrid.getEmptyText().setText("请求加载失败，请重试");
            requestGrid.setEnabled(true);
            if (requestDetailVisible) clearSelectedRequestState();
            updatePagerButtons();
        });
    }

    private void appendSessionRangeArgs(List<String> args) {
        AnalyticsRange range = selectedSessionRange();
        if (range == AnalyticsRange.ALL_TIME) return;
        long now = System.currentTimeMillis();
        CodeArtsSettings.State settings = CodeArtsSettings.getInstance().getState();
        AnalyticsRange.Window window = range.resolve(now, java.time.ZoneId.systemDefault(),
                settings.sessionCustomStart, settings.sessionCustomEnd);
        args.addAll(List.of("--start", Long.toString(window.start()), "--end", Long.toString(window.end())));
    }

    private void selectRequest() {
        int viewRow = requestGrid.getSelectedRow();
        if (viewRow < 0) return;
        int modelRow = requestGrid.convertRowIndexToModel(viewRow);
        if (modelRow < 0 || modelRow >= requestRows.size()) return;
        UsageSnapshot.RequestInfo row = requestRows.get(modelRow);
        selectedRequestKey = requestKey(row);
        requestDetailVisible = true;
        requestDetailTitle.setText(empty(row.model(), empty(row.provider(), "请求详情")));
        String detailMeta = date(row.time()) + " · " + sourceLabel(row.source()) + " · "
                + row.displayStatus() + " · 总耗时 " + duration((double) row.latencyMs());
        requestDetailMeta.setText(detailMeta);
        requestDetailMeta.setToolTipText(detailMeta);
        requestInput.setText(tokens(row.input()));
        requestOutput.setText(tokens(row.output()));
        requestReasoning.setText(tokens(row.reasoning()));
        requestCache.setText(tokens(row.cacheRead()) + " / " + tokens(row.cacheWrite()));
        requestTtft.setText(duration(row.ttftMs()));
        requestFirstContent.setText(duration(row.firstContentMs()));
        requestSpeed.setText(row.outputTokensPerSec() == null ? "--" : new DecimalFormat("0.0/s").format(row.outputTokensPerSec()));
        requestError.setText(row.error().isBlank() ? "" : "错误：" + safeText(row.error()));
        requestContentLayout.show(requestContentDeck, "detail");
        requestContentDeck.revalidate();
    }

    private boolean restoreRequestSelection() {
        if (selectedRequestKey.isBlank()) return false;
        for (int modelRow = 0; modelRow < requestRows.size(); modelRow++) {
            if (!selectedRequestKey.equals(requestKey(requestRows.get(modelRow)))) continue;
            int viewRow = requestGrid.convertRowIndexToView(modelRow);
            if (viewRow < 0) return false;
            requestGrid.getSelectionModel().setSelectionInterval(viewRow, viewRow);
            selectRequest();
            return true;
        }
        return false;
    }

    private void clearSelectedRequestState() {
        selectedRequestKey = "";
        requestDetailVisible = false;
        requestGrid.clearSelection();
        requestDetailTitle.setText("请求详情");
        requestDetailMeta.setText("选择一条请求查看 Token 拆分与性能");
        requestDetailMeta.setToolTipText(null);
        for (JBLabel value : new JBLabel[]{requestInput, requestOutput, requestReasoning, requestCache, requestTtft, requestFirstContent, requestSpeed}) {
            value.setText("--");
        }
        requestError.setText("");
        requestContentLayout.show(requestContentDeck, "list");
        requestContentDeck.revalidate();
        requestContentDeck.repaint();
    }

    private void updatePagerButtons() {
        previousSessions.setEnabled(sessionPage > 1);
        nextSessions.setEnabled(sessionPage < sessionPageCount);
        previousRequests.setEnabled(!selectedSessionId.isBlank() && requestPage > 1);
        nextRequests.setEnabled(!selectedSessionId.isBlank() && requestPage < requestPageCount);
    }

    private void showQueryError(String message) {
        refreshState.setText(message);
        refreshState.setForeground(DANGER);
        refreshState.setToolTipText(message);
    }

    private void loadAnalyticsRange() {
        long generation = analyticsQueryGeneration.incrementAndGet();
        cancelQuery(analyticsQueryTask);
        AnalyticsRange range = selectedAnalyticsRange();
        long now = System.currentTimeMillis();
        CodeArtsSettings.State settings = CodeArtsSettings.getInstance().getState();
        AnalyticsRange.Window window = range.resolve(now, java.time.ZoneId.systemDefault(),
                settings.analyticsCustomStart, settings.analyticsCustomEnd);
        java.time.ZoneId zone = java.time.ZoneId.systemDefault();
        long transitionBucketMs = AnalyticsRange.transitionSafeBucketMs(window.start(), window.end(), zone);
        boolean calendarRebucket = !window.hourly() && transitionBucketMs < window.bucketMs();
        long queryBucketMs = calendarRebucket ? transitionBucketMs : window.bucketMs();
        long midpoint = window.start() + (window.end() - window.start()) / 2;
        long bucketOffsetMs = zone.getRules().getOffset(java.time.Instant.ofEpochMilli(midpoint)).getTotalSeconds() * 1_000L;
        List<String> args = new ArrayList<>(List.of(
                "--start", Long.toString(window.start()),
                "--end", Long.toString(window.end()),
                "--bucket-ms", Long.toString(queryBucketMs),
                "--bucket-offset-ms", Long.toString(bucketOffsetMs)));
        Object selectedModel = analyticsModel.getSelectedItem();
        if (analyticsModel.getSelectedIndex() > 0 && selectedModel != null) args.addAll(List.of("--model", selectedModel.toString()));
        String selectedAnalyticsSource = selectedAnalyticsSourceId();
        if (!selectedAnalyticsSource.isBlank()) args.addAll(List.of("--source", selectedAnalyticsSource));
        String label = window.label();
        refreshState.setText("正在更新 " + label + "...");
        analyticsQueryTask = service.query("analytics", args, data -> {
            if (disposed || generation != analyticsQueryGeneration.get()) return;
            if (!current.ok()) return;
            UsageSnapshot.AnalyticsData analytics = UsageSnapshot.analytics(data);
            if (calendarRebucket) {
                analytics = UsageSnapshot.withLocalDailyTrend(analytics, window.start(), window.end(), zone);
            }
            renderAnalyticsData(analytics, label, window.hourly());
            hasRenderedAnalytics = true;
            analyticsDisplay.markSuccess(label);
            showOverviewState(hasAnyLocalUsage() ? "data" : "empty");
            refreshState.setForeground(MUTED);
            refreshState.setText("已更新 " + label);
        }, message -> {
            if (disposed || generation != analyticsQueryGeneration.get()) return;
            UsageSnapshot baseSnapshot = service.getSnapshot();
            if (!baseSnapshot.ok()) {
                current = baseSnapshot;
                renderReadFailure(baseSnapshot.error());
                return;
            }
            showQueryError(analyticsDisplay.failure(label, message));
            if (!hasRenderedAnalytics) showOverviewState("analyticsError");
        });
    }

    private AnalyticsRange selectedAnalyticsRange() {
        Object selected = usageRange.getSelectedItem();
        return selected instanceof AnalyticsRange range ? range : AnalyticsRange.TODAY;
    }

    private static void ensureCustomRangeDefaults(CodeArtsSettings.State settings, boolean analytics) {
        String rangeId = analytics ? settings.analyticsRange : settings.sessionRange;
        if (!AnalyticsRange.fromId(rangeId).custom()) return;
        AnalyticsRange.Bounds bounds = AnalyticsRange.normalizeCustomBounds(System.currentTimeMillis(),
                analytics ? settings.analyticsCustomStart : settings.sessionCustomStart,
                analytics ? settings.analyticsCustomEnd : settings.sessionCustomEnd);
        if (analytics) {
            settings.analyticsCustomStart = bounds.start();
            settings.analyticsCustomEnd = bounds.end();
        } else {
            settings.sessionCustomStart = bounds.start();
            settings.sessionCustomEnd = bounds.end();
        }
    }

    private boolean editCustomRange() {
        CodeArtsSettings.State settings = CodeArtsSettings.getInstance().getState();
        if (settings.analyticsCustomStart <= 0 || settings.analyticsCustomEnd <= settings.analyticsCustomStart) {
            long now = System.currentTimeMillis();
            settings.analyticsCustomStart = now - 7L * 86_400_000L;
            settings.analyticsCustomEnd = now;
        }
        CustomRangeDialog dialog = new CustomRangeDialog("自定义 Token 时间范围",
                settings.analyticsCustomStart, settings.analyticsCustomEnd);
        if (!dialog.showAndGet()) return false;
        settings.analyticsCustomStart = dialog.start();
        settings.analyticsCustomEnd = dialog.end();
        return true;
    }

    private void finishCustomRangeSelection(AnalyticsRange range) {
        if (disposed) return;
        if (!editCustomRange()) {
            changingUsageRange = true;
            usageRange.setSelectedItem(appliedUsageRange);
            changingUsageRange = false;
            updateRangeDescriptions();
            return;
        }
        applyUsageRange(range);
    }

    private void applyUsageRange(AnalyticsRange range) {
        appliedUsageRange = range;
        CodeArtsSettings.getInstance().getState().analyticsRange = range.id();
        updateRangeDescriptions();
        if (current.ok()) loadAnalyticsRange();
    }

    private AnalyticsRange selectedSessionRange() {
        Object selected = sessionTimeRange.getSelectedItem();
        return selected instanceof AnalyticsRange range ? range : AnalyticsRange.ALL_TIME;
    }

    private void finishCustomSessionRangeSelection(AnalyticsRange range) {
        if (disposed) return;
        CodeArtsSettings.State settings = CodeArtsSettings.getInstance().getState();
        AnalyticsRange.Bounds bounds = AnalyticsRange.normalizeCustomBounds(System.currentTimeMillis(),
                settings.sessionCustomStart, settings.sessionCustomEnd);
        CustomRangeDialog dialog = new CustomRangeDialog("自定义会话时间范围", bounds.start(), bounds.end());
        if (!dialog.showAndGet()) {
            changingSessionRange = true;
            sessionTimeRange.setSelectedItem(appliedSessionRange);
            changingSessionRange = false;
            updateRangeDescriptions();
            return;
        }
        settings.sessionCustomStart = dialog.start();
        settings.sessionCustomEnd = dialog.end();
        applySessionRange(range);
    }

    private void applySessionRange(AnalyticsRange range) {
        appliedSessionRange = range;
        CodeArtsSettings.getInstance().getState().sessionRange = range.id();
        updateRangeDescriptions();
        startNewSearch();
    }

    private void updateRangeDescriptions() {
        CodeArtsSettings.State settings = CodeArtsSettings.getInstance().getState();
        long now = System.currentTimeMillis();
        java.time.ZoneId zone = java.time.ZoneId.systemDefault();
        String usageDescription = rangeDescription("Token 时间范围", selectedAnalyticsRange(), now, zone,
                settings.analyticsCustomStart, settings.analyticsCustomEnd);
        String sessionDescription = rangeDescription("会话时间范围", selectedSessionRange(), now, zone,
                settings.sessionCustomStart, settings.sessionCustomEnd);
        usageRange.setToolTipText(usageDescription);
        usageRange.getAccessibleContext().setAccessibleDescription(usageDescription);
        sessionTimeRange.setToolTipText(sessionDescription);
        sessionTimeRange.getAccessibleContext().setAccessibleDescription(sessionDescription);
    }

    private static String rangeDescription(String prefix, AnalyticsRange range, long now, java.time.ZoneId zone,
                                           long customStart, long customEnd) {
        if (!range.custom()) return prefix + "：" + range.label();
        return prefix + "：" + range.resolve(now, zone, customStart, customEnd).label() + "（再次选择可编辑）";
    }

    private String sessionQueryLabel(String query) {
        AnalyticsRange range = selectedSessionRange();
        CodeArtsSettings.State settings = CodeArtsSettings.getInstance().getState();
        String time = range.custom()
                ? range.resolve(System.currentTimeMillis(), java.time.ZoneId.systemDefault(),
                        settings.sessionCustomStart, settings.sessionCustomEnd).label()
                : range.label();
        String source = sessionSource.getSelectedIndex() == 0
                ? "全部来源" : String.valueOf(sessionSource.getSelectedItem());
        return time + " · " + source + (query.isBlank() ? "" : " · 搜索结果");
    }

    private static void installCustomRangeReopen(JComboBox<AnalyticsRange> comboBox, Runnable edit) {
        comboBox.addPopupMenuListener(new PopupMenuListener() {
            private boolean openedOnCustom;
            private boolean canceled;

            @Override public void popupMenuWillBecomeVisible(PopupMenuEvent event) {
                openedOnCustom = comboBox.getSelectedItem() == AnalyticsRange.CUSTOM;
                canceled = false;
            }

            @Override public void popupMenuWillBecomeInvisible(PopupMenuEvent event) {
                if (!canceled && openedOnCustom && comboBox.getSelectedItem() == AnalyticsRange.CUSTOM) {
                    SwingUtilities.invokeLater(edit);
                }
                openedOnCustom = false;
            }

            @Override public void popupMenuCanceled(PopupMenuEvent event) {
                canceled = true;
            }
        });
    }

    private static final class CustomRangeDialog extends DialogWrapper {
        private final JSpinner startSpinner;
        private final JSpinner endSpinner;

        CustomRangeDialog(String title, long start, long end) {
            super(true);
            setTitle(title);
            setOKButtonText("应用");
            startSpinner = dateSpinner(start, "开始日期和时间");
            endSpinner = dateSpinner(end, "结束日期和时间");
            init();
        }

        @Override protected JComponent createCenterPanel() {
            JPanel panel = new JPanel(new GridBagLayout());
            panel.setBorder(JBUI.Borders.empty(8, 4, 4, 4));
            GridBagConstraints constraints = new GridBagConstraints();
            constraints.gridx = 0;
            constraints.gridy = 0;
            constraints.anchor = GridBagConstraints.WEST;
            constraints.insets = JBUI.insets(0, 0, 8, 10);
            panel.add(new JBLabel("开始时间："), constraints);
            constraints.gridx = 1;
            constraints.weightx = 1;
            constraints.fill = GridBagConstraints.HORIZONTAL;
            constraints.insets = JBUI.insetsBottom(8);
            panel.add(startSpinner, constraints);
            constraints.gridx = 0;
            constraints.gridy = 1;
            constraints.weightx = 0;
            constraints.fill = GridBagConstraints.NONE;
            constraints.insets = JBUI.insetsRight(10);
            panel.add(new JBLabel("结束时间："), constraints);
            constraints.gridx = 1;
            constraints.weightx = 1;
            constraints.fill = GridBagConstraints.HORIZONTAL;
            constraints.insets = JBUI.emptyInsets();
            panel.add(endSpinner, constraints);
            panel.getAccessibleContext().setAccessibleName(getTitle());
            return panel;
        }

        @Override protected ValidationInfo doValidate() {
            if (end() <= start()) return new ValidationInfo("结束时间必须晚于开始时间", endSpinner);
            if (end() > System.currentTimeMillis() + 60_000L) return new ValidationInfo("结束时间不能晚于当前时间", endSpinner);
            if (end() - start() > 366L * 86_400_000L) return new ValidationInfo("时间范围最多支持 366 天", startSpinner);
            return null;
        }

        long start() { return ((Date) startSpinner.getValue()).getTime(); }
        long end() { return ((Date) endSpinner.getValue()).getTime(); }

        private static JSpinner dateSpinner(long value, String accessibleName) {
            JSpinner spinner = new JSpinner(new SpinnerDateModel(new Date(value), null, null, java.util.Calendar.MINUTE));
            spinner.setEditor(new JSpinner.DateEditor(spinner, "yyyy-MM-dd HH:mm"));
            spinner.getAccessibleContext().setAccessibleName(accessibleName);
            return spinner;
        }
    }

    private static final class ResponsiveHeader extends JPanel {
        private final JComponent title;
        private final JComponent control;
        private boolean stacked;

        ResponsiveHeader(JComponent title, JComponent control) {
            this.title = title;
            this.control = control;
            setOpaque(false);
            addComponentListener(new ComponentAdapter() {
                @Override public void componentResized(ComponentEvent event) { updateLayout(); }
            });
            updateLayout();
        }

        private void updateLayout() {
            boolean next = getWidth() > 0 && getWidth() < JBUI.scale(360);
            if (getComponentCount() > 0 && next == stacked) return;
            stacked = next;
            removeAll();
            if (stacked) {
                setLayout(new BorderLayout(0, JBUI.scale(8)));
                add(title, BorderLayout.NORTH);
                add(control, BorderLayout.CENTER);
            } else {
                setLayout(new BorderLayout(JBUI.scale(12), 0));
                add(title, BorderLayout.CENTER);
                add(control, BorderLayout.EAST);
            }
            revalidate();
        }
    }

    private boolean hasAnyLocalUsage() {
        return current.ok() && (current.all().total() > 0 || current.sessionTotal() > 0 || !current.models().isEmpty());
    }

    private void renderAnalyticsData(UsageSnapshot.AnalyticsData data, String label, boolean hourly) {
        UsageSnapshot.UsageWindow usage = data.usage();
        String completeness = data.sampled() ? "抽样数据" : data.complete() ? "完整数据" : "部分数据";
        usageHero.setMetrics(tokens(usage.total()), number(usage.total()), number(usage.messages()), label + " · " + completeness);
        inputMetric.setMetric(tokens(usage.input()), ratio(usage.input(), usage.total()));
        outputMetric.setMetric(tokens(usage.output()), ratio(usage.output(), usage.total()));
        cacheWriteMetric.setMetric(tokens(usage.cacheWrite()), ratio(usage.cacheWrite(), usage.total()));
        cacheReadMetric.setMetric(tokens(usage.cacheRead()), ratio(usage.cacheRead(), usage.total()));

        Double hitRate = usage.cacheHitRate();
        int cachePercentage = hitRate == null ? 0 : (int) Math.max(0, Math.min(100, Math.round(hitRate)));
        cacheProgress.setValue(cachePercentage);
        cacheRateValue.setText(hitRate == null ? "--" : percent(hitRate));
        cacheRateMeta.setText("命中 " + tokens(usage.cacheRead()) + " · 创建 " + tokens(usage.cacheWrite()));
        chart.setData(data.trend(), hourly);
        fillModels(data.models());
        fillProviders(data.providers());
        fillSources(data.sources());
        UsageSnapshot.Performance performance = data.performance();
        diagnosticLatencyMetric.setMetric(duration(performance.latencyP95()), number(performance.samples()) + " 个样本");
        diagnosticErrorMetric.setMetric(number(performance.errors()), performance.errorRate() == null ? "无错误率" : percent(performance.errorRate() * 100));
        UsageSnapshot.MetricCompleteness metrics = data.metrics();
        String metricState = "延迟 " + (metrics.latency() ? "完整" : "部分")
                + " · 首内容 " + (metrics.firstContentApprox() ? "完整" : "部分")
                + " · 输出速度 " + (metrics.outputTokensPerSec() ? "完整" : "部分")
                + " · TTFT " + (metrics.ttft() ? "完整" : "不可用");
        health.setToolTipText(metricState);
        updateFilterOptions(data.models(), data.projects());
    }

    private void fillModels(List<UsageSnapshot.ModelUsage> rows) {
        clear(modelTable);
        for (UsageSnapshot.ModelUsage row : rows) {
            modelTable.addRow(new Object[]{
                    new RichText(empty(row.name(), row.model()), empty(row.provider(), row.model())),
                    row.total(), row.requests(), duration(row.latencyP95())});
        }
    }

    private void fillSources(List<UsageSnapshot.SourceInfo> rows) {
        clear(sourceTable);
        for (UsageSnapshot.SourceInfo row : rows) {
            sourceTable.addRow(new Object[]{
                    new RichText(empty(row.label(), "未知来源"), empty(row.adapter(), "本地适配器")),
                    row.total(), row.requests(), row.errors()});
        }
    }

    private void fillSessions(List<UsageSnapshot.SessionInfo> rows) {
        clear(sessionTable);
        for (UsageSnapshot.SessionInfo row : rows) {
            sessionTable.addRow(new Object[]{
                    new RichText(safeText(empty(row.title(), "无标题会话")), sourceLabel(row.source()) + " · " + empty(row.model(), "未识别模型")),
                    row.total(), date(row.updatedAt())});
        }
    }

    private void fillRequests(List<UsageSnapshot.RequestInfo> rows) {
        clear(requestTable);
        for (UsageSnapshot.RequestInfo row : rows) {
            requestTable.addRow(new Object[]{
                    new RichText(date(row.time()), empty(row.model(), empty(row.provider(), sourceLabel(row.source())))),
                    row.total(), duration((double) row.latencyMs()), row.success() ? "成功" : "错误"});
        }
    }

    private void renderDiagnostics(UsageSnapshot snapshot) {
        boolean healthy = snapshot.health().issues().isEmpty();
        diagnosticTitle.setText(empty(snapshot.health().label(), healthy ? "本地数据正常" : "发现需要检查的问题"));
        diagnosticTitle.setForeground(healthy ? SUCCESS : CACHE_WRITE);
        diagnosticMeta.setText(empty(snapshot.health().message(), healthy ? "数据库与适配器可用" : "请查看下方技术详情"));
        diagnosticDatabaseMetric.setMetric("本地 SQLite", snapshot.adapter());
        diagnosticLatencyMetric.setMetric(duration(snapshot.performance().latencyP95()), number(snapshot.performance().samples()) + " 个样本");
        diagnosticErrorMetric.setMetric(number(snapshot.performance().errors()), healthy ? "未发现健康问题" : snapshot.health().issues().size() + " 项提示");
        diagnosticSessionMetric.setMetric(number(snapshot.sessionTotal()), number(snapshot.sessionActive()) + " 个活跃");

        StringBuilder report = new StringBuilder();
        report.append("数据健康\n").append(safeText(snapshot.health().label())).append(" · ").append(safeText(snapshot.health().message())).append('\n');
        for (String issue : snapshot.health().issues()) report.append(" - ").append(safeText(issue)).append('\n');
        report.append("\n数据库\n位置：本机（路径未传入插件界面）")
                .append("\n大小：").append(number(snapshot.dbSize())).append(" bytes")
                .append("\n适配器：").append(snapshot.adapter())
                .append("\n协议：v").append(snapshot.protocolVersion());
        report.append("\n\n响应性能\n样本：").append(number(snapshot.performance().samples()))
                .append("\n错误：").append(number(snapshot.performance().errors()))
                .append("\n平均 / P95：").append(duration(snapshot.performance().latencyAvg())).append(" / ").append(duration(snapshot.performance().latencyP95()))
                .append("\nTTFT 平均 / P95：").append(duration(snapshot.performance().ttftAvg())).append(" / ").append(duration(snapshot.performance().ttftP95()));
        report.append("\n\n排队\n样本：").append(number(snapshot.queue().samples()))
                .append("\n平均 / P95 / 最大：").append(duration(snapshot.queue().avgMs())).append(" / ").append(duration(snapshot.queue().p95Ms())).append(" / ").append(duration(snapshot.queue().maxMs()));
        report.append("\n\n会话\n总数：").append(number(snapshot.sessionTotal()))
                .append("\n活跃：").append(number(snapshot.sessionActive()));
        if (!snapshot.quota().note().isBlank()) report.append("\n\n配额说明\n").append(safeText(snapshot.quota().note()));
        diagnostics.setText(report.toString());
        diagnostics.setCaretPosition(0);
    }

    private void buildRequestDetailPanel() {
        requestDetailPanel.setBorder(JBUI.Borders.empty(9));
        JPanel headingRow = transparent(new BorderLayout(JBUI.scale(8), 0));
        JPanel heading = transparent();
        heading.setLayout(new BoxLayout(heading, BoxLayout.Y_AXIS));
        requestDetailTitle.setFont(requestDetailTitle.getFont().deriveFont(Font.BOLD, 12f));
        heading.add(requestDetailTitle);
        heading.add(Box.createVerticalStrut(JBUI.scale(2)));
        heading.add(requestDetailMeta);
        headingRow.add(heading, BorderLayout.CENTER);
        headingRow.add(button("返回请求", this::clearSelectedRequestState), BorderLayout.EAST);
        requestDetailPanel.add(headingRow, BorderLayout.NORTH);

        JPanel facts = groupedGrid(4, 2,
                fact("输入", requestInput), fact("输出", requestOutput),
                fact("推理", requestReasoning), fact("缓存命中 / 创建", requestCache),
                fact("TTFT", requestTtft), fact("首内容", requestFirstContent),
                fact("输出速度", requestSpeed), fact("状态", requestError));
        requestDetailPanel.add(facts, BorderLayout.CENTER);
    }

    private void openSelectedSessionFolder() {
        if (selectedSessionDirectory.isBlank()) return;
        try {
            File directory = new File(selectedSessionDirectory);
            if (Desktop.isDesktopSupported() && directory.isDirectory()) Desktop.getDesktop().open(directory);
            else showQueryError("无法打开会话目录");
        } catch (Exception error) {
            showQueryError("打开目录失败：" + error.getMessage());
        }
    }

    private void copySelectedSessionId() {
        if (selectedSessionId.isBlank()) return;
        Toolkit.getDefaultToolkit().getSystemClipboard().setContents(new StringSelection(selectedSessionId), null);
        refreshState.setForeground(MUTED);
        refreshState.setText("已复制会话 ID");
    }

    void setDashboardVisible(boolean visible) {
        if (visible) activateDataSubscription();
        else deactivateDataSubscription();
    }

    private void activateDataSubscription() {
        if (disposed || subscription != null) return;
        subscription = service.subscribe(this::render);
        service.refresh(false);
    }

    private void deactivateDataSubscription() {
        if (subscription == null) return;
        try { subscription.close(); } catch (Exception ignored) { }
        subscription = null;
        analyticsQueryGeneration.incrementAndGet();
        sessionQueryGeneration.incrementAndGet();
        requestQueryGeneration.incrementAndGet();
        filterQueryGeneration.incrementAndGet();
        diagnosticsQueryGeneration.incrementAndGet();
        cancelQuery(analyticsQueryTask);
        cancelQuery(sessionQueryTask);
        cancelQuery(requestQueryTask);
        cancelQuery(filterQueryTask);
        cancelQuery(diagnosticsQueryTask);
    }

    private void fillProviders(List<UsageSnapshot.ProviderUsage> rows) {
        clear(providerTable);
        for (UsageSnapshot.ProviderUsage row : rows) {
            providerTable.addRow(new Object[]{new RichText(empty(row.name(), "unknown"), "Provider"), row.total(), row.requests(), row.errors()});
        }
    }

    record SessionExportOptions(boolean includeContent, boolean includeToolIO, boolean redactPaths, boolean includeErrors) {
        static SessionExportOptions defaults() {
            return new SessionExportOptions(true, false, true, true);
        }

        void appendCliArgs(List<String> args) {
            if (!includeContent) args.add("--no-content");
            if (includeToolIO) args.add("--include-tool-io");
            if (!redactPaths) args.add("--no-redact-paths");
            if (!includeErrors) args.add("--no-errors");
        }
    }

    private void updateFilterOptions(List<UsageSnapshot.ModelUsage> models, List<UsageSnapshot.ProjectInfo> projects) {
        String selectedModel = analyticsModel.getSelectedIndex() > 0 ? String.valueOf(analyticsModel.getSelectedItem()) : "";
        String selectedSessionModel = sessionModel.getSelectedIndex() > 0 ? String.valueOf(sessionModel.getSelectedItem()) : "";
        String selectedProject = sessionProject.getSelectedItem() instanceof UsageSnapshot.ProjectInfo item ? item.id() : "";
        loadingFilterOptions = true;
        analyticsModel.removeAllItems();
        analyticsModel.addItem("全部模型");
        for (UsageSnapshot.ModelUsage model : models) analyticsModel.addItem(empty(model.model(), model.name()));
        if (!selectedModel.isBlank()) analyticsModel.setSelectedItem(selectedModel);
        sessionModel.removeAllItems();
        sessionModel.addItem("全部模型");
        for (UsageSnapshot.ModelUsage model : models) sessionModel.addItem(empty(model.model(), model.name()));
        if (!selectedSessionModel.isBlank()) sessionModel.setSelectedItem(selectedSessionModel);
        sessionProject.removeAllItems();
        sessionProject.addItem(new UsageSnapshot.ProjectInfo("", "", 0));
        for (UsageSnapshot.ProjectInfo item : projects) sessionProject.addItem(item);
        for (int index = 0; index < sessionProject.getItemCount(); index++) {
            if (selectedProject.equals(sessionProject.getItemAt(index).id())) { sessionProject.setSelectedIndex(index); break; }
        }
        loadingFilterOptions = false;
    }

    private void loadFilterOptions() {
        long generation = filterQueryGeneration.incrementAndGet();
        cancelQuery(filterQueryTask);
        filterQueryTask = service.query("filters", List.of(), data -> {
            if (disposed || generation != filterQueryGeneration.get()) return;
            updateFilterOptions(UsageSnapshot.filterModels(data), UsageSnapshot.filterProjects(data));
        }, message -> {
            if (disposed || generation != filterQueryGeneration.get()) return;
            refreshState.setToolTipText("筛选选项加载失败：" + message);
        });
    }

    private void showSessionExportMenu() {
        if (selectedSessionId.isBlank()) return;
        JPopupMenu menu = new JPopupMenu();
        JMenuItem excel = new JMenuItem("Excel (.xlsx)");
        JMenuItem markdown = new JMenuItem("Markdown (.md)");
        JMenuItem json = new JMenuItem("JSON (.json)");
        excel.addActionListener(event -> chooseSessionExport("xlsx", "xlsx"));
        markdown.addActionListener(event -> chooseSessionExport("md", "md"));
        json.addActionListener(event -> chooseSessionExport("json", "json"));
        menu.add(excel); menu.add(markdown); menu.add(json);
        menu.show(exportSessionButton, 0, exportSessionButton.getHeight());
    }

    private void chooseSessionExport(String format, String extension) {
        SessionExportOptionsDialog optionsDialog = new SessionExportOptionsDialog();
        if (!optionsDialog.showAndGet()) return;
        SessionExportOptions options = optionsDialog.options();
        JFileChooser chooser = new JFileChooser();
        chooser.setDialogTitle("导出会话为 " + extension.toUpperCase());
        chooser.setSelectedFile(new File(safeExportFileName(selectedSessionTitle, extension)));
        if (chooser.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) return;
        File selected = chooser.getSelectedFile();
        if (!selected.getName().toLowerCase().endsWith("." + extension)) selected = new File(selected.getParentFile(), selected.getName() + "." + extension);
        if (selected.exists() && Messages.showYesNoDialog(project,
                "文件已存在，是否覆盖？\n" + selected.getName(), "确认覆盖导出文件",
                Messages.getWarningIcon()) != Messages.YES) return;
        File outputFile = selected;
        List<String> args = new ArrayList<>(List.of("--session-id", selectedSessionId, "--source", selectedSessionSource, "--format", format, "--output", outputFile.getAbsolutePath()));
        options.appendCliArgs(args);
        refreshState.setForeground(MUTED);
        refreshState.setText("正在导出会话...");
        exportSessionButton.setEnabled(false);
        service.exportSession(args, result -> {
            exportSessionButton.setEnabled(true);
            refreshState.setText("会话已导出：" + outputFile.getName());
        }, message -> {
            exportSessionButton.setEnabled(true);
            showQueryError("会话导出失败：" + message);
        });
    }

    static String safeExportFileName(String title, String extension) {
        String stem = (title == null || title.isBlank() ? "codearts-session" : title)
                .replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]", "_")
                .replaceAll("[. ]+$", "");
        if (stem.isBlank()) stem = "codearts-session";
        if (stem.matches("(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\..*)?$")) stem = "_" + stem;
        int[] codePoints = stem.codePoints().limit(100).toArray();
        stem = new String(codePoints, 0, codePoints.length);
        return stem + "." + extension;
    }

    private void loadDatabaseDiagnostics() {
        long generation = diagnosticsQueryGeneration.incrementAndGet();
        cancelQuery(diagnosticsQueryTask);
        diagnosticsQueryTask = service.query("diagnostics", List.of(), data -> {
            if (disposed || generation != diagnosticsQueryGeneration.get()) return;
            var items = data.has("items") && data.get("items").isJsonArray() ? data.getAsJsonArray("items") : new com.google.gson.JsonArray();
            var errors = data.has("sourceErrors") && data.get("sourceErrors").isJsonArray() ? data.getAsJsonArray("sourceErrors") : new com.google.gson.JsonArray();
            long sessions = 0, messages = 0;
            int quickCheckFailures = 0;
            StringBuilder report = new StringBuilder("数据库健康\n");
            for (var element : items) {
                if (!element.isJsonObject()) continue;
                JsonObject item = element.getAsJsonObject();
                long sessionCount = item.has("sessionCount") ? item.get("sessionCount").getAsLong() : 0;
                long messageCount = item.has("messageCount") ? item.get("messageCount").getAsLong() : 0;
                String quickCheck = item.has("quickCheck") ? item.get("quickCheck").getAsString() : "unknown";
                if (!"ok".equalsIgnoreCase(quickCheck)) quickCheckFailures++;
                sessions += sessionCount; messages += messageCount;
                report.append(" - ").append(safeText(item.has("label") ? item.get("label").getAsString() : "本地数据源"))
                        .append("：quick_check=").append(safeText(quickCheck))
                        .append(" · ").append(sessionCount).append(" 会话 · ").append(messageCount).append(" 消息\n");
            }
            for (var element : errors) if (element.isJsonObject()) {
                JsonObject error = element.getAsJsonObject();
                report.append(" - 读取失败：").append(SensitiveText.safeSummary(error.has("message") ? error.get("message").getAsString() : "数据源读取失败")).append('\n');
            }
            int issueCount = errors.size() + quickCheckFailures;
            diagnosticTitle.setText(issueCount == 0 ? "数据库检查正常" : quickCheckFailures > 0 ? "数据库完整性检查异常" : "部分数据源不可用");
            diagnosticTitle.setForeground(issueCount == 0 ? SUCCESS : quickCheckFailures > 0 ? DANGER : CACHE_WRITE);
            diagnosticMeta.setText(items.size() + " 个数据源 · quick_check 与表结构已检查");
            diagnosticDatabaseMetric.setMetric(number(items.size()), issueCount == 0 ? "全部可读" : issueCount + " 个异常");
            diagnosticErrorMetric.setMetric(number(issueCount), issueCount == 0 ? "未发现数据库异常" : "数据库健康提示");
            diagnosticSessionMetric.setMetric(number(sessions), number(messages) + " 条消息");
            diagnostics.setText(report.toString());
            diagnostics.setCaretPosition(0);
        }, message -> {
            if (disposed || generation != diagnosticsQueryGeneration.get()) return;
            diagnosticTitle.setText("数据库健康读取失败");
            diagnosticTitle.setForeground(DANGER);
            diagnosticMeta.setText(SensitiveText.safeSummary(message));
        });
    }

    private void copyDiagnostics() {
        diagnostics.selectAll();
        diagnostics.copy();
        diagnostics.select(0, 0);
        refreshState.setForeground(MUTED);
        refreshState.setText("已复制脱敏诊断报告");
    }

    private void openSettings() {
        ShowSettingsUtil.getInstance().showSettingsDialog(project, "CodeArts Bar");
    }

    private String selectedSourceId() {
        return switch (sessionSource.getSelectedIndex()) {
            case 1 -> "desktop";
            case 2 -> "cli";
            case 3 -> "custom";
            default -> "";
        };
    }

    private String selectedAnalyticsSourceId() {
        return switch (analyticsSource.getSelectedIndex()) {
            case 1 -> "desktop";
            case 2 -> "cli";
            case 3 -> "custom";
            default -> "";
        };
    }

    private static JPanel progressCard(String title, JBLabel value, JProgressBar progress, JBLabel meta) {
        JPanel panel = transparent(new BorderLayout(JBUI.scale(8), JBUI.scale(6)));
        panel.setBorder(JBUI.Borders.empty(10, 12));
        JPanel heading = transparent(new BorderLayout(JBUI.scale(8), 0));
        JBLabel label = new JBLabel(title);
        label.setForeground(MUTED);
        label.setFont(label.getFont().deriveFont(Font.BOLD, 11f));
        heading.add(label, BorderLayout.CENTER);
        heading.add(value, BorderLayout.EAST);
        panel.add(heading, BorderLayout.NORTH);
        panel.add(progress, BorderLayout.CENTER);
        panel.add(meta, BorderLayout.SOUTH);
        return panel;
    }

    private static JPanel statePanel(String title, String description, JComponent action) {
        return statePanel(title, stateDescription(description), action);
    }

    private static JPanel statePanel(String title, JBTextArea body, JComponent action) {
        RoundedPanel panel = new RoundedPanel(new BorderLayout(), 10, SURFACE);
        panel.setBorder(JBUI.Borders.empty(22));
        JPanel content = transparent(new GridBagLayout());
        GridBagConstraints constraints = new GridBagConstraints();
        constraints.gridx = 0;
        constraints.gridy = 0;
        constraints.anchor = GridBagConstraints.CENTER;
        JBLabel heading = new JBLabel(title);
        heading.setFont(heading.getFont().deriveFont(Font.BOLD, 16f));
        content.add(heading, constraints);
        constraints.gridy++;
        constraints.insets = JBUI.insetsTop(6);
        constraints.fill = GridBagConstraints.HORIZONTAL;
        constraints.weightx = 1;
        content.add(body, constraints);
        constraints.fill = GridBagConstraints.NONE;
        constraints.weightx = 0;
        if (action != null) {
            constraints.gridy++;
            constraints.insets = JBUI.insetsTop(12);
            content.add(action, constraints);
        } else {
            constraints.gridy++;
            constraints.insets = JBUI.insetsTop(12);
            JProgressBar loading = new JProgressBar();
            loading.setIndeterminate(true);
            loading.setPreferredSize(new Dimension(JBUI.scale(180), JBUI.scale(8)));
            content.add(loading, constraints);
        }
        panel.add(content, BorderLayout.NORTH);
        panel.setPreferredSize(new Dimension(0, JBUI.scale(180)));
        return panel;
    }

    private static JBTextArea stateDescription(String text) {
        JBTextArea body = new JBTextArea(text);
        body.setEditable(false);
        body.setFocusable(false);
        body.setOpaque(false);
        body.setLineWrap(true);
        body.setWrapStyleWord(true);
        body.setRows(2);
        body.setColumns(28);
        body.setFont(new JBLabel().getFont().deriveFont(11f));
        body.setForeground(MUTED);
        body.setBorder(JBUI.Borders.empty());
        return body;
    }

    private static JPanel pager(JButton previous, JBLabel label, JButton next) {
        JPanel panel = transparent(new BorderLayout(JBUI.scale(8), 0));
        panel.setBorder(JBUI.Borders.empty(4, 0, 0, 0));
        panel.add(previous, BorderLayout.WEST);
        label.setHorizontalAlignment(SwingConstants.CENTER);
        panel.add(label, BorderLayout.CENTER);
        panel.add(next, BorderLayout.EAST);
        return panel;
    }

    private static JPanel fact(String caption, JBLabel value) {
        JPanel panel = transparent(new BorderLayout());
        panel.setBorder(JBUI.Borders.empty(5, 7));
        JBLabel label = mutedLabel(caption);
        panel.add(label, BorderLayout.WEST);
        panel.add(value, BorderLayout.EAST);
        return panel;
    }

    private static JProgressBar progressBar(Color color) {
        JProgressBar progress = new JProgressBar(0, 100);
        progress.setBorderPainted(false);
        progress.setStringPainted(false);
        progress.setForeground(color);
        progress.setPreferredSize(new Dimension(0, JBUI.scale(8)));
        return progress;
    }

    private static JBLabel valueLabel(String text) {
        JBLabel label = new JBLabel(text);
        label.setFont(label.getFont().deriveFont(Font.BOLD, 12f));
        return label;
    }

    private static JBLabel mutedLabel(String text) {
        JBLabel label = new JBLabel(text);
        label.setForeground(MUTED);
        label.setFont(label.getFont().deriveFont(10.5f));
        return label;
    }

    private static JBLabel factValue() {
        JBLabel label = new JBLabel("--");
        label.setHorizontalAlignment(SwingConstants.RIGHT);
        label.setFont(label.getFont().deriveFont(Font.BOLD, 10.5f));
        return label;
    }

    private static void setColumnWidths(JBTable table, int... widths) {
        for (int index = 0; index < Math.min(widths.length, table.getColumnCount()); index++) {
            table.getColumnModel().getColumn(index).setPreferredWidth(JBUI.scale(widths[index]));
            table.getColumnModel().getColumn(index).setMinWidth(JBUI.scale(Math.min(widths[index], index == 0 ? 95 : 44)));
        }
    }

    private static void clear(DefaultTableModel model) { model.setRowCount(0); }

    private static int intValue(JsonObject object, String key, int fallback) {
        try { return object.has(key) ? object.get(key).getAsInt() : fallback; }
        catch (Exception ignored) { return fallback; }
    }

    private static String number(long value) { return new DecimalFormat("#,##0").format(value); }
    private static String tokens(long value) {
        if (value >= 1_000_000) return new DecimalFormat("0.00M").format(value / 1_000_000d);
        if (value >= 1_000) return new DecimalFormat("0.0K").format(value / 1_000d);
        return number(value);
    }
    private static String percent(Double value) { return value == null ? "--" : new DecimalFormat("0.0").format(value) + "%"; }
    private static String ratio(long value, long total) {
        if (total <= 0) return "占比 0%";
        return "占比 " + new DecimalFormat("0.#").format(value * 100d / total) + "%";
    }
    private static String duration(Double value) {
        if (value == null) return "--";
        return value >= 1000 ? new DecimalFormat("0.00s").format(value / 1000) : new DecimalFormat("0ms").format(value);
    }
    private static String date(long milliseconds) {
        return milliseconds <= 0 ? "--" : DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(new Date(milliseconds));
    }
    private static String requestKey(UsageSnapshot.RequestInfo row) {
        return String.join("\u001f", empty(row.source(), ""), empty(row.id(), ""),
                Long.toString(row.time()), empty(row.model(), ""), Long.toString(row.total()));
    }
    private static String empty(String value, String fallback) { return value == null || value.isBlank() ? fallback : value; }
    private static String safeText(String value) { return SensitiveText.redact(value); }
    private static String sourceLabel(String source) {
        return switch (empty(source, "unknown")) {
            case "desktop" -> "桌面端";
            case "cli" -> "CLI";
            case "custom" -> "自定义";
            default -> source;
        };
    }
    private static void cancelQuery(Future<?> task) {
        if (task != null && !task.isDone()) task.cancel(true);
    }
    @Override public void dispose() {
        disposed = true;
        searchTimer.stop();
        deactivateDataSubscription();
    }
}

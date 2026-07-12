package com.codearts.bar.toolwindow;

import com.intellij.icons.AllIcons;
import com.intellij.ui.JBColor;
import com.intellij.ui.scale.JBUIScale;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.components.JBPanel;
import com.intellij.ui.components.JBScrollPane;
import com.intellij.ui.table.JBTable;
import com.intellij.util.ui.JBUI;

import javax.swing.*;
import javax.accessibility.AccessibleContext;
import javax.accessibility.AccessibleRole;
import javax.swing.table.DefaultTableCellRenderer;
import javax.swing.table.DefaultTableModel;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.geom.RoundRectangle2D;

final class DashboardUi {
    static final JBColor ACCENT = new JBColor(new Color(0, 122, 255), new Color(10, 132, 255));
    static final JBColor TOTAL = new JBColor(new Color(244, 63, 94), new Color(251, 113, 133));
    static final JBColor INPUT = new JBColor(new Color(47, 125, 246), new Color(96, 165, 250));
    static final JBColor OUTPUT = new JBColor(new Color(22, 184, 98), new Color(74, 222, 128));
    static final JBColor CACHE_WRITE = new JBColor(new Color(249, 115, 22), new Color(251, 146, 60));
    static final JBColor CACHE_READ = new JBColor(new Color(155, 87, 255), new Color(192, 132, 252));
    static final JBColor SUCCESS = new JBColor(new Color(8, 160, 69), new Color(74, 222, 128));
    static final JBColor DANGER = new JBColor(new Color(220, 38, 38), new Color(248, 113, 113));
    static final Color PRIMARY = JBColor.foreground();
    static final JBColor MUTED = JBColor.namedColor("Label.infoForeground",
            new JBColor(new Color(94, 94, 99), new Color(174, 174, 178)));
    static final JBColor SUBTLE = JBColor.namedColor("Label.disabledForeground",
            new JBColor(new Color(125, 125, 130), new Color(142, 142, 147)));
    static final JBColor CANVAS = new JBColor(new Color(245, 245, 247), new Color(28, 28, 30));
    static final JBColor SURFACE = new JBColor(new Color(255, 255, 255), new Color(44, 44, 46));
    static final JBColor SURFACE_ALT = new JBColor(new Color(247, 247, 249), new Color(36, 36, 38));
    static final JBColor CONTROL_FILL = new JBColor(new Color(232, 232, 237), new Color(58, 58, 60));
    static final JBColor SEGMENT_SELECTED = new JBColor(new Color(255, 255, 255), new Color(92, 92, 96));
    static final JBColor HOVER = new JBColor(new Color(238, 243, 249), new Color(51, 54, 58));
    static final JBColor SELECTION = new JBColor(new Color(218, 233, 252), new Color(25, 60, 94));
    static final JBColor SELECTION_MUTED = new JBColor(new Color(75, 91, 110), new Color(199, 214, 230));
    static final JBColor BORDER = new JBColor(new Color(209, 209, 214), new Color(72, 72, 74));
    static final JBColor SEPARATOR = new JBColor(new Color(229, 229, 234), new Color(58, 58, 60));

    private DashboardUi() {}

    static JPanel sectionHeader(String title, String subtitle, JComponent action) {
        JPanel root = transparent(new BorderLayout(0, JBUI.scale(7)));
        JPanel copy = transparent();
        copy.setLayout(new BoxLayout(copy, BoxLayout.Y_AXIS));
        JBLabel heading = new JBLabel(title);
        heading.setFont(roleFont(heading, Font.BOLD, 4f, 16f));
        JBLabel description = new JBLabel(subtitle);
        description.setForeground(MUTED);
        description.setFont(roleFont(description, Font.PLAIN, -1f, 11f));
        copy.add(heading);
        copy.add(Box.createVerticalStrut(JBUI.scale(3)));
        copy.add(description);
        root.add(copy, BorderLayout.CENTER);
        if (action != null) {
            JPanel actionRow = transparent(new BorderLayout());
            actionRow.add(action, BorderLayout.EAST);
            root.add(actionRow, BorderLayout.SOUTH);
        }
        return root;
    }

    static JPanel segmentedBar(ViewToggleButton... buttons) {
        RoundedPanel panel = new RoundedPanel(new GridLayout(1, buttons.length, JBUI.scale(1), 0), 9, CONTROL_FILL);
        panel.setBorder(JBUI.Borders.empty(3));
        panel.getAccessibleContext().setAccessibleName("分段视图选择");
        for (ViewToggleButton button : buttons) panel.add(button);
        installSegmentNavigation(buttons);
        return panel;
    }

    private static void installSegmentNavigation(ViewToggleButton[] buttons) {
        for (int index = 0; index < buttons.length; index++) {
            int current = index;
            buttons[index].getInputMap(JComponent.WHEN_FOCUSED).put(KeyStroke.getKeyStroke("LEFT"), "previousSegment");
            buttons[index].getInputMap(JComponent.WHEN_FOCUSED).put(KeyStroke.getKeyStroke("RIGHT"), "nextSegment");
            buttons[index].getActionMap().put("previousSegment", new AbstractAction() {
                @Override public void actionPerformed(java.awt.event.ActionEvent event) {
                    activateSegment(buttons, current - 1);
                }
            });
            buttons[index].getActionMap().put("nextSegment", new AbstractAction() {
                @Override public void actionPerformed(java.awt.event.ActionEvent event) {
                    activateSegment(buttons, current + 1);
                }
            });
        }
    }

    private static void activateSegment(ViewToggleButton[] buttons, int index) {
        if (buttons.length == 0) return;
        ViewToggleButton next = buttons[Math.floorMod(index, buttons.length)];
        next.requestFocusInWindow();
        next.doClick();
    }

    static ViewToggleButton viewButton(String text, boolean selected, Runnable action) {
        ViewToggleButton button = new ViewToggleButton(text);
        button.setSelected(selected);
        button.getAccessibleContext().setAccessibleName(text);
        button.getAccessibleContext().setAccessibleDescription("切换到" + text + "视图");
        button.addActionListener(event -> action.run());
        return button;
    }

    static JButton iconButton(String tooltip, Icon icon, Runnable action) {
        JButton button = new JButton(icon);
        button.putClientProperty("JButton.buttonType", "toolBarButton");
        button.setBorder(JBUI.Borders.empty(6));
        button.setPreferredSize(new Dimension(JBUI.scale(32), JBUI.scale(30)));
        button.setToolTipText(tooltip);
        button.getAccessibleContext().setAccessibleName(tooltip);
        button.addActionListener(event -> action.run());
        return button;
    }

    static JButton button(String text, Runnable action) {
        JButton button = new JButton(text);
        button.setMargin(JBUI.insets(4, 10));
        if (action != null) button.addActionListener(event -> action.run());
        return button;
    }

    static DefaultTableModel model(String[] columns) {
        return new DefaultTableModel(columns, 0) {
            @Override public boolean isCellEditable(int row, int column) { return false; }

            @Override public Class<?> getColumnClass(int column) {
                for (int row = 0; row < getRowCount(); row++) {
                    Object value = getValueAt(row, column);
                    if (value != null) return value.getClass();
                }
                return Object.class;
            }
        };
    }

    static PolishedTable table(DefaultTableModel model, String emptyText) {
        PolishedTable table = new PolishedTable(model);
        table.getEmptyText().setText(emptyText);
        return table;
    }

    static JComponent tableSurface(JBTable table) {
        JBScrollPane scroll = new JBScrollPane(table);
        scroll.setBorder(JBUI.Borders.empty());
        scroll.getViewport().setBackground(SURFACE);
        RoundedPanel surface = new RoundedPanel(new BorderLayout(), 10, SURFACE, false);
        surface.setBorder(JBUI.Borders.empty(1));
        surface.add(scroll);
        return surface;
    }

    static JPanel groupedGrid(int rows, int columns, JComponent... components) {
        GroupedGridPanel panel = new GroupedGridPanel(rows, columns);
        for (JComponent component : components) panel.add(component);
        return panel;
    }

    static void installRichRenderer(JBTable table, int richColumn) {
        table.getColumnModel().getColumn(richColumn).setCellRenderer(new RichTextRenderer());
    }

    static void installNumberRenderer(JBTable table, int column, NumberFormatter formatter) {
        table.getColumnModel().getColumn(column).setCellRenderer(new NumberRenderer(formatter));
    }

    static void installRightRenderer(JBTable table, int column) {
        table.getColumnModel().getColumn(column).setCellRenderer(new RightRenderer());
    }

    static JPanel transparent() {
        return transparent(new FlowLayout(FlowLayout.LEFT, 0, 0));
    }

    static JPanel transparent(LayoutManager layout) {
        JPanel panel = new JPanel(layout);
        panel.setOpaque(false);
        return panel;
    }

    static void stretch(JComponent component) {
        component.setAlignmentX(Component.LEFT_ALIGNMENT);
        Dimension preferred = component.getPreferredSize();
        component.setMaximumSize(new Dimension(Integer.MAX_VALUE, preferred.height));
        component.setMinimumSize(new Dimension(0, Math.max(0, component.getMinimumSize().height)));
    }

    static void allowNarrow(Component component) {
        if (component instanceof JComponent ui) {
            Dimension minimum = ui.getMinimumSize();
            ui.setMinimumSize(new Dimension(0, Math.max(0, minimum.height)));
        }
        if (component instanceof Container container) {
            for (Component child : container.getComponents()) allowNarrow(child);
        }
    }

    private static Font roleFont(JComponent component, int style, float delta, float minimum) {
        float size = Math.max(minimum, component.getFont().getSize2D() + delta);
        return component.getFont().deriveFont(style, size);
    }

    interface NumberFormatter {
        String format(Number value);
    }

    record RichText(String title, String subtitle) {
        @Override public String toString() { return title; }
    }

    static final class HeroMetricCard extends RoundedPanel {
        private final JBLabel value = new JBLabel("--");
        private final JBLabel context = new JBLabel("等待本地数据");
        private final JBLabel requestValue = new JBLabel("--");
        private Font valueFont;

        HeroMetricCard() {
            super(new BorderLayout(JBUI.scale(12), 0), 10, SURFACE);
            setBorder(JBUI.Borders.empty(14, 16));
            setMinimumSize(new Dimension(0, JBUI.scale(100)));

            add(new JBLabel(new BoltIcon()), BorderLayout.WEST);

            JPanel copy = transparent();
            copy.setLayout(new BoxLayout(copy, BoxLayout.Y_AXIS));
            JBLabel caption = new JBLabel("真实消耗 Token");
            caption.setForeground(MUTED);
            caption.setFont(roleFont(caption, Font.BOLD, -1f, 11f));
            valueFont = roleFont(value, Font.BOLD, 13f, 24f);
            value.setFont(valueFont);
            context.setForeground(SUBTLE);
            context.setFont(roleFont(context, Font.PLAIN, -2f, 10f));
            copy.add(caption);
            copy.add(Box.createVerticalStrut(JBUI.scale(2)));
            copy.add(value);
            add(copy, BorderLayout.CENTER);

            JPanel footer = transparent(new BorderLayout(JBUI.scale(8), 0));
            footer.add(context, BorderLayout.CENTER);
            JPanel requests = transparent(new FlowLayout(FlowLayout.RIGHT, JBUI.scale(4), 0));
            JBLabel requestCaption = new JBLabel("请求");
            requestCaption.setForeground(MUTED);
            requestCaption.setFont(roleFont(requestCaption, Font.BOLD, -2f, 10f));
            requestValue.setHorizontalAlignment(SwingConstants.RIGHT);
            requestValue.setFont(roleFont(requestValue, Font.BOLD, -1f, 11f));
            requests.add(requestCaption);
            requests.add(requestValue);
            footer.add(requests, BorderLayout.EAST);
            add(footer, BorderLayout.SOUTH);
        }

        void setMetrics(String total, String exactTotal, String requests, String periodContext) {
            value.setText(total);
            value.setToolTipText("总 Token：" + exactTotal);
            requestValue.setText(requests);
            context.setText(periodContext);
        }

        @Override public void doLayout() {
            super.doLayout();
            Container parent = value.getParent();
            if (parent == null || parent.getWidth() <= 0) return;
            int available = Math.max(JBUI.scale(48), parent.getWidth() - JBUI.scale(2));
            float size = valueFont.getSize2D();
            Font fitted = valueFont;
            while (size > 16f && value.getFontMetrics(fitted).stringWidth(value.getText()) > available) {
                size -= 1f;
                fitted = valueFont.deriveFont(size);
            }
            value.setFont(fitted);
        }
    }

    static final class MetricCard extends JBPanel<MetricCard> {
        private final JBLabel value = new JBLabel("--");
        private final JBLabel detail = new JBLabel("等待数据");

        MetricCard(String caption, Color accent) {
            super(new BorderLayout());
            setOpaque(false);
            setBorder(JBUI.Borders.empty(11, 14));
            setMinimumSize(new Dimension(0, JBUI.scale(78)));

            JPanel top = transparent(new FlowLayout(FlowLayout.LEFT, JBUI.scale(7), 0));
            top.add(new JBLabel(new DotIcon(accent, 8)));
            JBLabel label = new JBLabel(caption);
            label.setForeground(MUTED);
            label.setFont(roleFont(label, Font.BOLD, -2f, 10f));
            top.add(label);
            add(top, BorderLayout.NORTH);

            value.setFont(roleFont(value, Font.BOLD, 7f, 18f));
            add(value, BorderLayout.CENTER);
            detail.setForeground(SUBTLE);
            detail.setFont(roleFont(detail, Font.PLAIN, -3f, 10f));
            add(detail, BorderLayout.SOUTH);
        }

        void setMetric(String nextValue, String nextDetail) {
            value.setText(nextValue);
            detail.setText(nextDetail);
            setToolTipText(null);
        }
    }

    static final class MiniStatCard extends JBPanel<MiniStatCard> {
        private final JBLabel value = new JBLabel("--");
        private final JBLabel detail = new JBLabel("等待数据");

        MiniStatCard(String caption, Color accent) {
            super(new BorderLayout());
            setOpaque(false);
            setBorder(JBUI.Borders.empty(9, 12));
            JPanel title = transparent(new FlowLayout(FlowLayout.LEFT, JBUI.scale(6), 0));
            title.add(new JBLabel(new DotIcon(accent, 7)));
            JBLabel label = new JBLabel(caption);
            label.setForeground(MUTED);
            label.setFont(roleFont(label, Font.BOLD, -2f, 10f));
            title.add(label);
            add(title, BorderLayout.NORTH);
            value.setFont(roleFont(value, Font.BOLD, 5f, 17f));
            add(value, BorderLayout.CENTER);
            detail.setForeground(SUBTLE);
            detail.setFont(roleFont(detail, Font.PLAIN, -3f, 10f));
            add(detail, BorderLayout.SOUTH);
        }

        void setMetric(String nextValue, String nextDetail) {
            value.setText(nextValue);
            detail.setText(nextDetail);
        }
    }

    static final class SessionInspectorHeader extends RoundedPanel {
        private final JBLabel title = new JBLabel("选择一个会话");
        private final JBLabel meta = new JBLabel("在会话列表中选择后查看请求明细");
        private final JBLabel tokenValue = new JBLabel("--");
        private final JBLabel requestValue = new JBLabel("--");
        private final PillLabel status = new PillLabel("等待选择", MUTED);

        SessionInspectorHeader() {
            super(new BorderLayout(0, JBUI.scale(10)), 10, SURFACE);
            setBorder(JBUI.Borders.empty(11, 12));

            JPanel heading = transparent(new BorderLayout(JBUI.scale(8), 0));
            JPanel copy = transparent();
            copy.setLayout(new BoxLayout(copy, BoxLayout.Y_AXIS));
            title.setFont(roleFont(title, Font.BOLD, 1f, 13f));
            meta.setForeground(MUTED);
            meta.setFont(roleFont(meta, Font.PLAIN, -2f, 10f));
            copy.add(title);
            copy.add(Box.createVerticalStrut(JBUI.scale(3)));
            copy.add(meta);
            heading.add(copy, BorderLayout.CENTER);
            heading.add(status, BorderLayout.EAST);
            add(heading, BorderLayout.NORTH);

            JPanel facts = groupedGrid(1, 2, fact("总 Token", tokenValue), fact("请求", requestValue));
            add(facts, BorderLayout.CENTER);
        }

        void setEmpty() {
            title.setText("选择一个会话");
            meta.setText("在会话列表中选择后查看请求明细");
            tokenValue.setText("--");
            requestValue.setText("--");
            status.setText("等待选择");
            status.setAccent(MUTED);
            meta.setToolTipText(null);
            setToolTipText(null);
        }

        void setSession(String nextTitle, String nextMeta, String token, String requests, String tooltip) {
            title.setText(nextTitle);
            meta.setText(nextMeta);
            meta.setToolTipText(null);
            tokenValue.setText(token);
            requestValue.setText(requests);
            status.setText("已选择");
            status.setAccent(SUCCESS);
            setToolTipText(tooltip);
        }

        private static JPanel fact(String caption, JBLabel value) {
            JPanel panel = transparent(new BorderLayout());
            panel.setBorder(JBUI.Borders.empty(6, 9));
            JBLabel label = new JBLabel(caption);
            label.setForeground(MUTED);
            label.setFont(roleFont(label, Font.PLAIN, -3f, 10f));
            value.setHorizontalAlignment(SwingConstants.RIGHT);
            value.setFont(roleFont(value, Font.BOLD, -1f, 11f));
            panel.add(label, BorderLayout.WEST);
            panel.add(value, BorderLayout.EAST);
            return panel;
        }
    }

    static final class ViewToggleButton extends JToggleButton {
        ViewToggleButton(String text) {
            super(text);
            setContentAreaFilled(false);
            setFocusPainted(false);
            setRolloverEnabled(true);
            setOpaque(false);
            setBorder(JBUI.Borders.empty(6, 10));
            setFont(roleFont(this, Font.BOLD, -1f, 11f));
        }

        @Override public AccessibleContext getAccessibleContext() {
            if (accessibleContext == null) accessibleContext = new AccessibleSegmentButton();
            return accessibleContext;
        }

        protected class AccessibleSegmentButton extends AccessibleJToggleButton {
            @Override public AccessibleRole getAccessibleRole() { return AccessibleRole.RADIO_BUTTON; }
        }

        @Override public Color getForeground() {
            return isSelected() ? PRIMARY : MUTED;
        }

        @Override protected void paintComponent(Graphics graphics) {
            Graphics2D g = (Graphics2D) graphics.create();
            try {
                g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                int arc = JBUI.scale(7);
                if (isSelected()) {
                    g.setColor(SEGMENT_SELECTED);
                    g.fillRoundRect(0, 0, getWidth(), getHeight(), arc, arc);
                    g.setColor(BORDER);
                    g.drawRoundRect(0, 0, getWidth() - 1, getHeight() - 1, arc, arc);
                } else if (getModel().isRollover()) {
                    g.setColor(HOVER);
                    g.fillRoundRect(0, 0, getWidth(), getHeight(), arc, arc);
                }
                if (hasFocus()) {
                    g.setColor(ACCENT);
                    g.setStroke(new BasicStroke(JBUIScale.scale(1.5f)));
                    g.drawRoundRect(2, 2, getWidth() - 5, getHeight() - 5, arc, arc);
                }
            } finally {
                g.dispose();
            }
            super.paintComponent(graphics);
        }
    }

    static class RoundedPanel extends JBPanel<RoundedPanel> {
        private final int radius;
        private final boolean outline;

        RoundedPanel(LayoutManager layout, int radius, Color background) {
            this(layout, radius, background, true);
        }

        RoundedPanel(LayoutManager layout, int radius, Color background, boolean outline) {
            super(layout);
            this.radius = radius;
            this.outline = outline;
            setOpaque(false);
            setBackground(background);
        }

        @Override protected void paintComponent(Graphics graphics) {
            Graphics2D g = (Graphics2D) graphics.create();
            try {
                g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                g.setColor(getBackground());
                int arc = JBUI.scale(radius);
                g.fill(new RoundRectangle2D.Float(0, 0, Math.max(0, getWidth() - 1),
                        Math.max(0, getHeight() - 1), arc, arc));
            } finally {
                g.dispose();
            }
            super.paintComponent(graphics);
        }

        @Override protected void paintBorder(Graphics graphics) {
            if (!outline) return;
            Graphics2D g = (Graphics2D) graphics.create();
            try {
                g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                g.setColor(BORDER);
                int arc = JBUI.scale(radius);
                float stroke = JBUIScale.scale(1f);
                float inset = stroke / 2f;
                g.setStroke(new BasicStroke(stroke));
                g.draw(new RoundRectangle2D.Float(inset, inset, Math.max(0, getWidth() - stroke),
                        Math.max(0, getHeight() - stroke), arc, arc));
            } finally {
                g.dispose();
            }
        }
    }

    private static final class GroupedGridPanel extends RoundedPanel {
        private final int rows;
        private final int columns;

        GroupedGridPanel(int rows, int columns) {
            super(new GridLayout(rows, columns, 0, 0), 10, SURFACE);
            this.rows = rows;
            this.columns = columns;
        }

        @Override protected void paintChildren(Graphics graphics) {
            super.paintChildren(graphics);
            Graphics2D g = (Graphics2D) graphics.create();
            try {
                g.setColor(SEPARATOR);
                g.setStroke(new BasicStroke(JBUIScale.scale(1f)));
                for (int column = 1; column < columns; column++) {
                    int x = getWidth() * column / columns;
                    g.drawLine(x, JBUI.scale(1), x, Math.max(JBUI.scale(1), getHeight() - JBUI.scale(2)));
                }
                for (int row = 1; row < rows; row++) {
                    int y = getHeight() * row / rows;
                    g.drawLine(JBUI.scale(1), y, Math.max(JBUI.scale(1), getWidth() - JBUI.scale(2)), y);
                }
            } finally {
                g.dispose();
            }
        }
    }

    static final class AdaptiveSplitPane extends JSplitPane {
        private Boolean horizontal;
        private double horizontalDivider = 0.54;
        private double verticalDivider = 0.44;

        AdaptiveSplitPane(JComponent first, JComponent second) {
            super(JSplitPane.VERTICAL_SPLIT, first, second);
            setBorder(null);
            setDividerSize(JBUI.scale(8));
            setContinuousLayout(true);
        }

        @Override public void doLayout() {
            int enterHorizontal = JBUI.scale(760);
            int leaveHorizontal = JBUI.scale(680);
            boolean nextHorizontal = horizontal == null
                    ? getWidth() >= JBUI.scale(720)
                    : horizontal ? getWidth() >= leaveHorizontal : getWidth() >= enterHorizontal;
            if (horizontal == null || horizontal != nextHorizontal) {
                if (horizontal != null) saveDividerLocation();
                horizontal = nextHorizontal;
                setOrientation(nextHorizontal ? JSplitPane.HORIZONTAL_SPLIT : JSplitPane.VERTICAL_SPLIT);
                setResizeWeight(nextHorizontal ? 0.54 : 0.44);
                super.doLayout();
                setDividerLocation(nextHorizontal ? horizontalDivider : verticalDivider);
            }
            super.doLayout();
            restoreDividerIfCompressed();
        }

        private void restoreDividerIfCompressed() {
            if (horizontal == null) return;
            int available = horizontal
                    ? getWidth() - getDividerSize()
                    : getHeight() - getDividerSize();
            if (available <= 0) return;

            int desiredFirst = JBUI.scale(horizontal ? 320 : 210);
            int desiredSecond = JBUI.scale(horizontal ? 280 : 230);
            int minimumFirst = Math.min(desiredFirst, available / 2);
            int minimumSecond = Math.min(desiredSecond, available - minimumFirst);
            int maximumFirst = Math.max(minimumFirst, available - minimumSecond);
            int current = getDividerLocation();
            if (current >= minimumFirst && current <= maximumFirst) return;

            double proportion = horizontal ? horizontalDivider : verticalDivider;
            int restored = (int) Math.round(available * proportion);
            setDividerLocation(Math.max(minimumFirst, Math.min(maximumFirst, restored)));
        }

        private void saveDividerLocation() {
            int available = horizontal
                    ? getWidth() - getDividerSize()
                    : getHeight() - getDividerSize();
            if (available <= 0) return;
            double proportion = Math.max(0.2, Math.min(0.8, getDividerLocation() / (double) available));
            if (horizontal) horizontalDivider = proportion;
            else verticalDivider = proportion;
        }
    }

    static final class ScrollablePanel extends JPanel implements Scrollable {
        ScrollablePanel() {
            setOpaque(false);
            setLayout(new BoxLayout(this, BoxLayout.Y_AXIS));
        }

        @Override public Dimension getPreferredScrollableViewportSize() { return getPreferredSize(); }
        @Override public int getScrollableUnitIncrement(Rectangle visibleRect, int orientation, int direction) { return JBUI.scale(16); }
        @Override public int getScrollableBlockIncrement(Rectangle visibleRect, int orientation, int direction) { return JBUI.scale(120); }
        @Override public boolean getScrollableTracksViewportWidth() { return true; }
        @Override public boolean getScrollableTracksViewportHeight() { return false; }
    }

    static final class PolishedTable extends JBTable {
        private int hoverRow = -1;

        PolishedTable(DefaultTableModel model) {
            super(model);
            setAutoCreateRowSorter(true);
            setShowGrid(false);
            setIntercellSpacing(new Dimension(0, 0));
            setFillsViewportHeight(true);
            setRowHeight(JBUI.scale(44));
            setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
            setSelectionBackground(SELECTION);
            setSelectionForeground(PRIMARY);
            setBackground(SURFACE);
            getTableHeader().setReorderingAllowed(false);
            getTableHeader().setPreferredSize(new Dimension(0, JBUI.scale(28)));
            getTableHeader().setBackground(SURFACE_ALT);
            getTableHeader().setForeground(MUTED);
            getTableHeader().setFont(roleFont(getTableHeader(), Font.BOLD, -2f, 10f));
            addMouseMotionListener(new MouseAdapter() {
                @Override public void mouseMoved(MouseEvent event) {
                    int next = rowAtPoint(event.getPoint());
                    if (next != hoverRow) {
                        hoverRow = next;
                        repaint();
                    }
                }
            });
            addMouseListener(new MouseAdapter() {
                @Override public void mouseExited(MouseEvent event) {
                    if (hoverRow != -1) {
                        hoverRow = -1;
                        repaint();
                    }
                }
            });
        }

        boolean isHoverRow(int row) { return row == hoverRow; }

        @Override protected void paintComponent(Graphics graphics) {
            super.paintComponent(graphics);
            Graphics2D g = (Graphics2D) graphics.create();
            try {
                g.setColor(SEPARATOR);
                g.setStroke(new BasicStroke(JBUIScale.scale(1f)));
                Rectangle clip = graphics.getClipBounds();
                int first = Math.max(0, rowAtPoint(new Point(0, clip.y)));
                int last = rowAtPoint(new Point(0, clip.y + clip.height - 1));
                if (last < 0) last = getRowCount() - 1;
                for (int row = first; row <= last && row < getRowCount(); row++) {
                    Rectangle cell = getCellRect(row, 0, true);
                    int y = cell.y + cell.height - 1;
                    g.drawLine(0, y, getWidth(), y);
                }
                if (hasFocus() && getSelectedRow() >= 0) {
                    Rectangle row = getCellRect(getSelectedRow(), 0, true);
                    g.setColor(ACCENT);
                    g.setStroke(new BasicStroke(JBUIScale.scale(1.5f)));
                    g.drawRoundRect(1, row.y + 1, Math.max(0, getWidth() - 3),
                            Math.max(0, row.height - 3), JBUI.scale(6), JBUI.scale(6));
                }
            } finally {
                g.dispose();
            }
        }

        @Override public String getToolTipText(MouseEvent event) {
            int row = rowAtPoint(event.getPoint());
            int column = columnAtPoint(event.getPoint());
            if (row < 0 || column < 0) return null;
            Object value = getValueAt(row, column);
            int available = Math.max(0, getCellRect(row, column, false).width - JBUI.scale(18));
            if (value instanceof RichText rich) {
                FontMetrics titleMetrics = getFontMetrics(getFont().deriveFont(Font.BOLD));
                FontMetrics subtitleMetrics = getFontMetrics(getFont());
                if (titleMetrics.stringWidth(rich.title()) <= available
                        && subtitleMetrics.stringWidth(rich.subtitle()) <= available) return null;
                String detail = rich.title() + (rich.subtitle().isBlank() ? "" : " · " + rich.subtitle());
                return boundedTooltip(detail);
            }
            String text = value == null ? "" : value.toString();
            return getFontMetrics(getFont()).stringWidth(text) > available ? boundedTooltip(text) : null;
        }

        private static String boundedTooltip(String text) {
            String value = text.length() > 500 ? text.substring(0, 499) + "…" : text;
            return "<html><body width='320'>" + value
                    .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    .replace("\"", "&quot;").replace("'", "&#39;") + "</body></html>";
        }
    }

    private static final class RichTextRenderer extends JPanel implements javax.swing.table.TableCellRenderer {
        private final JBLabel title = new JBLabel();
        private final JBLabel subtitle = new JBLabel();

        RichTextRenderer() {
            setLayout(new BoxLayout(this, BoxLayout.Y_AXIS));
            setBorder(JBUI.Borders.empty(5, 9));
            title.setFont(roleFont(title, Font.BOLD, -1f, 11f));
            subtitle.setForeground(MUTED);
            subtitle.setFont(roleFont(subtitle, Font.PLAIN, -3f, 10f));
            add(title);
            add(Box.createVerticalStrut(JBUI.scale(2)));
            add(subtitle);
        }

        @Override public Component getTableCellRendererComponent(JTable table, Object value, boolean isSelected,
                                                                  boolean hasFocus, int row, int column) {
            RichText rich = value instanceof RichText item ? item : new RichText(String.valueOf(value), "");
            title.setText(rich.title());
            subtitle.setText(rich.subtitle());
            subtitle.setVisible(!rich.subtitle().isBlank());
            setForeground(isSelected ? table.getSelectionForeground() : table.getForeground());
            title.setForeground(getForeground());
            subtitle.setForeground(isSelected ? SELECTION_MUTED : MUTED);
            setBackground(rowBackground(table, row, isSelected));
            return this;
        }
    }

    private static final class NumberRenderer extends DefaultTableCellRenderer {
        private final NumberFormatter formatter;

        NumberRenderer(NumberFormatter formatter) {
            this.formatter = formatter;
            setHorizontalAlignment(SwingConstants.RIGHT);
            setBorder(JBUI.Borders.empty(0, 9));
        }

        @Override public Component getTableCellRendererComponent(JTable table, Object value, boolean isSelected,
                                                                  boolean hasFocus, int row, int column) {
            Object display = value instanceof Number number ? formatter.format(number) : value;
            super.getTableCellRendererComponent(table, display, isSelected, hasFocus, row, column);
            setBackground(rowBackground(table, row, isSelected));
            setFont(roleFont(this, Font.BOLD, -2f, 10f));
            return this;
        }
    }

    private static final class RightRenderer extends DefaultTableCellRenderer {
        RightRenderer() {
            setHorizontalAlignment(SwingConstants.RIGHT);
            setBorder(JBUI.Borders.empty(0, 9));
        }

        @Override public Component getTableCellRendererComponent(JTable table, Object value, boolean isSelected,
                                                                  boolean hasFocus, int row, int column) {
            super.getTableCellRendererComponent(table, value, isSelected, hasFocus, row, column);
            setBackground(rowBackground(table, row, isSelected));
            setForeground(isSelected ? table.getSelectionForeground() : MUTED);
            setFont(roleFont(this, Font.PLAIN, -2f, 10f));
            return this;
        }
    }

    private static Color rowBackground(JTable table, int row, boolean selected) {
        if (selected) return table.getSelectionBackground();
        if (table instanceof PolishedTable polished && polished.isHoverRow(row)) return HOVER;
        return SURFACE;
    }

    private static final class PillLabel extends JBLabel {
        private Color accent;

        PillLabel(String text, Color accent) {
            super(text);
            this.accent = accent;
            setOpaque(false);
            setBorder(JBUI.Borders.empty(3, 8));
            setFont(roleFont(this, Font.BOLD, -3f, 10f));
            setHorizontalAlignment(SwingConstants.CENTER);
        }

        void setAccent(Color next) {
            accent = next;
            repaint();
        }

        @Override protected void paintComponent(Graphics graphics) {
            Graphics2D g = (Graphics2D) graphics.create();
            try {
                g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                g.setColor(new Color(accent.getRed(), accent.getGreen(), accent.getBlue(), 28));
                g.fillRoundRect(0, 0, getWidth() - 1, getHeight() - 1, getHeight(), getHeight());
                g.setColor(new Color(accent.getRed(), accent.getGreen(), accent.getBlue(), 100));
                g.drawRoundRect(0, 0, getWidth() - 1, getHeight() - 1, getHeight(), getHeight());
            } finally {
                g.dispose();
            }
            setForeground(accent);
            super.paintComponent(graphics);
        }
    }

    private static final class DotIcon implements Icon {
        private final Color color;
        private final int size;

        DotIcon(Color color, int size) {
            this.color = color;
            this.size = size;
        }

        @Override public void paintIcon(Component component, Graphics graphics, int x, int y) {
            Graphics2D g = (Graphics2D) graphics.create();
            try {
                g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                g.setColor(color);
                g.fillOval(x, y, getIconWidth(), getIconHeight());
            } finally {
                g.dispose();
            }
        }

        @Override public int getIconWidth() { return JBUI.scale(size); }
        @Override public int getIconHeight() { return JBUI.scale(size); }
    }

    private static final class BoltIcon implements Icon {
        @Override public void paintIcon(Component component, Graphics graphics, int x, int y) {
            Graphics2D g = (Graphics2D) graphics.create();
            try {
                g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                int size = getIconWidth();
                g.setColor(new Color(ACCENT.getRed(), ACCENT.getGreen(), ACCENT.getBlue(), 26));
                g.fillRoundRect(x, y, size, size, JBUI.scale(12), JBUI.scale(12));
                g.setColor(ACCENT);
                int sx = x + JBUI.scale(15);
                int sy = y + JBUI.scale(9);
                Polygon bolt = new Polygon(
                        new int[]{sx + JBUI.scale(7), sx, sx + JBUI.scale(5), sx + JBUI.scale(2), sx + JBUI.scale(13), sx + JBUI.scale(9)},
                        new int[]{sy, sy + JBUI.scale(14), sy + JBUI.scale(14), sy + JBUI.scale(26), sy + JBUI.scale(10), sy + JBUI.scale(10)},
                        6);
                g.fillPolygon(bolt);
            } finally {
                g.dispose();
            }
        }

        @Override public int getIconWidth() { return JBUI.scale(46); }
        @Override public int getIconHeight() { return JBUI.scale(46); }
    }
}

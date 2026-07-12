package com.codearts.bar.toolwindow;

import com.codearts.bar.model.UsageSnapshot;
import com.intellij.util.ui.JBUI;
import com.intellij.ui.scale.JBUIScale;

import javax.swing.*;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.event.FocusAdapter;
import java.awt.event.FocusEvent;
import java.awt.geom.Path2D;
import java.text.DecimalFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.function.ToLongFunction;

final class TrendChartPanel extends JPanel {
    private static final Color TOTAL = DashboardUi.TOTAL;
    private static final Color INPUT = DashboardUi.INPUT;
    private static final Color OUTPUT = DashboardUi.OUTPUT;
    private static final Color CACHE = DashboardUi.CACHE_READ;
    private static final Color MUTED = DashboardUi.MUTED;
    private static final Color GRID = DashboardUi.SEPARATOR;

    private List<UsageSnapshot.TrendPoint> points = List.of();
    private boolean hourly = true;
    private int hoverIndex = -1;
    private int keyboardIndex = -1;

    TrendChartPanel() {
        setMinimumSize(new Dimension(0, JBUI.scale(180)));
        setPreferredSize(new Dimension(0, JBUI.scale(230)));
        setMaximumSize(new Dimension(Integer.MAX_VALUE, JBUI.scale(240)));
        setBorder(JBUI.Borders.empty(2, 0, 0, 0));
        setOpaque(false);
        setFocusable(true);
        getAccessibleContext().setAccessibleName("CodeArts Token 使用趋势");
        installKeyboardNavigation();
        addFocusListener(new FocusAdapter() {
            @Override public void focusGained(FocusEvent event) {
                if (keyboardIndex < 0 && !points.isEmpty()) keyboardIndex = firstMeaningfulPoint();
                updateAccessibleDescription();
                repaint();
            }

            @Override public void focusLost(FocusEvent event) { repaint(); }
        });
        addMouseMotionListener(new MouseAdapter() {
            @Override public void mouseMoved(MouseEvent event) {
                int next = indexAt(event.getX());
                if (next != hoverIndex) {
                    hoverIndex = next;
                    repaint();
                }
            }
        });
        addMouseListener(new MouseAdapter() {
            @Override public void mousePressed(MouseEvent event) {
                requestFocusInWindow();
                int next = indexAt(event.getX());
                if (next >= 0) keyboardIndex = next;
                updateAccessibleDescription();
                repaint();
            }

            @Override public void mouseExited(MouseEvent event) {
                hoverIndex = -1;
                repaint();
            }
        });
    }

    void setData(List<UsageSnapshot.TrendPoint> nextPoints, boolean nextHourly) {
        points = nextPoints == null ? List.of() : nextPoints;
        hourly = nextHourly;
        hoverIndex = -1;
        keyboardIndex = points.isEmpty() ? -1 : Math.min(Math.max(0, keyboardIndex), points.size() - 1);
        updateAccessibleDescription();
        repaint();
    }

    private void installKeyboardNavigation() {
        bindKey("LEFT", "previousPoint", -1);
        bindKey("RIGHT", "nextPoint", 1);
        bindKey("HOME", "firstPoint", Integer.MIN_VALUE);
        bindKey("END", "lastPoint", Integer.MAX_VALUE);
    }

    private void bindKey(String keyStroke, String actionName, int movement) {
        getInputMap(WHEN_FOCUSED).put(KeyStroke.getKeyStroke(keyStroke), actionName);
        getActionMap().put(actionName, new AbstractAction() {
            @Override public void actionPerformed(java.awt.event.ActionEvent event) { moveKeyboardSelection(movement); }
        });
    }

    private void moveKeyboardSelection(int movement) {
        if (points.isEmpty()) return;
        hoverIndex = -1;
        if (movement == Integer.MIN_VALUE) keyboardIndex = 0;
        else if (movement == Integer.MAX_VALUE) keyboardIndex = points.size() - 1;
        else keyboardIndex = Math.max(0, Math.min(points.size() - 1,
                    (keyboardIndex < 0 ? firstMeaningfulPoint() : keyboardIndex) + movement));
        updateAccessibleDescription();
        repaint();
    }

    private int firstMeaningfulPoint() {
        for (int index = 0; index < points.size(); index++) {
            UsageSnapshot.TrendPoint point = points.get(index);
            if (point.total() != 0 || point.input() != 0 || point.output() != 0 || point.cacheRead() != 0) return index;
        }
        return 0;
    }

    private int activeIndex() {
        if (hoverIndex >= 0) return hoverIndex;
        return hasFocus() ? keyboardIndex : -1;
    }

    private void updateAccessibleDescription() {
        if (points.isEmpty()) {
            getAccessibleContext().setAccessibleDescription("当前时间范围暂无趋势数据");
            return;
        }
        if (hasFocus() && keyboardIndex >= 0 && keyboardIndex < points.size()) {
            UsageSnapshot.TrendPoint point = points.get(keyboardIndex);
            getAccessibleContext().setAccessibleDescription(label(point) + "，总 Token " + point.total()
                    + "，输入 " + point.input() + "，输出 " + point.output() + "，缓存命中 " + point.cacheRead());
            return;
        }
        long total = points.stream().mapToLong(UsageSnapshot.TrendPoint::total).sum();
        getAccessibleContext().setAccessibleDescription(points.size() + " 个时间点，总 Token " + total);
    }

    @Override protected void paintComponent(Graphics graphics) {
        super.paintComponent(graphics);
        Graphics2D g = (Graphics2D) graphics.create();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
            drawFocusRing(g);

            Insets insets = getInsets();
            int left = insets.left + JBUI.scale(48);
            int right = insets.right + JBUI.scale(10);
            int top = insets.top + JBUI.scale(30);
            int bottom = insets.bottom + JBUI.scale(34);
            int width = getWidth() - left - right;
            int height = getHeight() - top - bottom;
            if (width <= JBUI.scale(20) || height <= JBUI.scale(20)) return;

            drawLegend(g, left, insets.top + JBUI.scale(4), width);
            drawGrid(g, left, top, width, height);

            if (points.isEmpty()) {
                drawEmptyState(g, left, top, width, height);
                return;
            }

            long max = points.stream()
                    .mapToLong(point -> Math.max(Math.max(point.total(), point.input()), Math.max(point.output(), point.cacheRead())))
                    .max().orElse(1);
            if (max <= 0) max = 1;
            drawYAxis(g, max, top, height);

            drawSeries(g, UsageSnapshot.TrendPoint::total, max, left, top, width, height, TOTAL,
                    new BasicStroke(JBUIScale.scale(2.2f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND,
                            JBUIScale.scale(10f), new float[]{JBUIScale.scale(6f), JBUIScale.scale(4f)}, 0));
            drawSeries(g, UsageSnapshot.TrendPoint::input, max, left, top, width, height, INPUT,
                    new BasicStroke(JBUIScale.scale(1.7f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            drawSeries(g, UsageSnapshot.TrendPoint::output, max, left, top, width, height, OUTPUT,
                    new BasicStroke(JBUIScale.scale(1.7f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            drawSeries(g, UsageSnapshot.TrendPoint::cacheRead, max, left, top, width, height, CACHE,
                    new BasicStroke(JBUIScale.scale(1.7f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            drawXAxis(g, left, top, width, height);
            drawHover(g, max, left, top, width, height);
        } finally {
            g.dispose();
        }
    }

    private void drawGrid(Graphics2D g, int left, int top, int width, int height) {
        g.setColor(GRID);
        g.setStroke(new BasicStroke(JBUIScale.scale(1f)));
        for (int index = 0; index <= 4; index++) {
            int y = top + height * index / 4;
            g.drawLine(left, y, left + width, y);
        }
    }

    private void drawYAxis(Graphics2D g, long max, int top, int height) {
        g.setFont(chartFont(Font.PLAIN, -3f, 9f));
        g.setColor(MUTED);
        FontMetrics metrics = g.getFontMetrics();
        for (int index = 0; index <= 4; index++) {
            long value = Math.round(max * (4 - index) / 4d);
            String label = compact(value);
            int x = Math.max(0, JBUI.scale(43) - metrics.stringWidth(label));
            g.drawString(label, x, top + height * index / 4 + metrics.getAscent() / 2);
        }
    }

    private void drawSeries(Graphics2D g, ToLongFunction<UsageSnapshot.TrendPoint> value, long max,
                            int left, int top, int width, int height, Color color, Stroke stroke) {
        Path2D line = new Path2D.Double();
        boolean drawing = false;
        for (int index = 0; index < points.size(); index++) {
            double x = xFor(index, left, width);
            double y = top + height - value.applyAsLong(points.get(index)) * height / (double) max;
            long bucketMs = hourly ? 3_600_000L : 86_400_000L;
            boolean gap = index > 0 && points.get(index).start() - points.get(index - 1).start() > bucketMs * 3L / 2L;
            if (!drawing || gap) line.moveTo(x, y);
            else line.lineTo(x, y);
            drawing = true;
        }
        g.setColor(color);
        g.setStroke(stroke);
        g.draw(line);
        if (points.size() <= 14) {
            int radius = JBUI.scale(points.size() == 1 ? 3 : 2);
            for (int index = 0; index < points.size(); index++) {
                int x = (int) Math.round(xFor(index, left, width));
                int y = (int) Math.round(top + height - value.applyAsLong(points.get(index)) * height / (double) max);
                g.fillOval(x - radius, y - radius, radius * 2, radius * 2);
            }
        }
    }

    private void drawXAxis(Graphics2D g, int left, int top, int width, int height) {
        g.setFont(chartFont(Font.PLAIN, -3f, 9f));
        g.setColor(MUTED);
        FontMetrics metrics = g.getFontMetrics();
        int count = Math.min(6, points.size());
        Set<Integer> indexes = new LinkedHashSet<>();
        if (count == 1) indexes.add(0);
        else {
            for (int slot = 0; slot < count; slot++) {
                indexes.add((int) Math.round(slot * (points.size() - 1d) / (count - 1d)));
            }
        }
        for (int index : indexes) {
            String text = label(points.get(index));
            int x = (int) Math.round(xFor(index, left, width));
            int textX = Math.max(left, Math.min(left + width - metrics.stringWidth(text), x - metrics.stringWidth(text) / 2));
            g.drawString(text, textX, top + height + JBUI.scale(22));
        }
    }

    private void drawHover(Graphics2D g, long max, int left, int top, int width, int height) {
        int activeIndex = activeIndex();
        if (activeIndex < 0 || activeIndex >= points.size()) return;
        double x = xFor(activeIndex, left, width);
        g.setColor(alpha(MUTED, 72));
        g.setStroke(new BasicStroke(JBUIScale.scale(1f)));
        g.drawLine((int) Math.round(x), top, (int) Math.round(x), top + height);

        UsageSnapshot.TrendPoint point = points.get(activeIndex);
        drawPoint(g, x, yFor(point.total(), max, top, height), TOTAL);
        drawPoint(g, x, yFor(point.input(), max, top, height), INPUT);
        drawPoint(g, x, yFor(point.output(), max, top, height), OUTPUT);
        drawPoint(g, x, yFor(point.cacheRead(), max, top, height), CACHE);
        drawTooltip(g, point, x, left, top, width);
    }

    private void drawPoint(Graphics2D g, double x, double y, Color color) {
        int radius = JBUI.scale(3);
        g.setColor(DashboardUi.SURFACE);
        g.fillOval((int) Math.round(x) - radius - 1, (int) Math.round(y) - radius - 1,
                radius * 2 + 2, radius * 2 + 2);
        g.setColor(color);
        g.fillOval((int) Math.round(x) - radius, (int) Math.round(y) - radius, radius * 2, radius * 2);
    }

    private void drawTooltip(Graphics2D g, UsageSnapshot.TrendPoint point, double pointX,
                             int left, int top, int availableWidth) {
        String title = label(point);
        String[] labels = {"总 Token", "输入", "输出", "缓存命中"};
        long[] values = {point.total(), point.input(), point.output(), point.cacheRead()};
        Color[] colors = {TOTAL, INPUT, OUTPUT, CACHE};
        String[] displayValues = new String[values.length];
        for (int index = 0; index < values.length; index++) displayValues[index] = number(values[index]);

        Font titleFont = chartFont(Font.BOLD, -2f, 10f);
        Font rowFont = chartFont(Font.PLAIN, -3f, 9f);
        FontMetrics titleMetrics = g.getFontMetrics(titleFont);
        FontMetrics rowMetrics = g.getFontMetrics(rowFont);
        int labelWidth = 0;
        int valueWidth = 0;
        for (int index = 0; index < labels.length; index++) {
            labelWidth = Math.max(labelWidth, rowMetrics.stringWidth(labels[index]));
            valueWidth = Math.max(valueWidth, rowMetrics.stringWidth(displayValues[index]));
        }
        int padding = JBUI.scale(10);
        int dotAndGap = JBUI.scale(16);
        int tooltipWidth = Math.max(JBUI.scale(132), Math.max(titleMetrics.stringWidth(title),
                dotAndGap + labelWidth + JBUI.scale(16) + valueWidth) + padding * 2);
        int rowHeight = Math.max(JBUI.scale(13), rowMetrics.getHeight() + JBUI.scale(1));
        int tooltipHeight = padding + titleMetrics.getHeight() + JBUI.scale(4)
                + labels.length * rowHeight + padding;
        int gap = JBUI.scale(9);
        int x = (int) Math.round(pointX) + gap;
        if (x + tooltipWidth > left + availableWidth) x = (int) Math.round(pointX) - tooltipWidth - gap;
        x = Math.max(left, x);
        int y = top + JBUI.scale(6);

        g.setColor(DashboardUi.SURFACE);
        g.fillRoundRect(x, y, tooltipWidth, tooltipHeight, JBUI.scale(8), JBUI.scale(8));
        g.setColor(DashboardUi.BORDER);
        g.drawRoundRect(x, y, tooltipWidth, tooltipHeight, JBUI.scale(8), JBUI.scale(8));

        g.setFont(titleFont);
        g.setColor(DashboardUi.PRIMARY);
        int titleY = y + padding + titleMetrics.getAscent();
        g.drawString(title, x + padding, titleY);

        g.setFont(rowFont);
        for (int index = 0; index < labels.length; index++) {
            int rowY = titleY + JBUI.scale(6) + rowMetrics.getAscent() + index * rowHeight;
            g.setColor(colors[index]);
            g.fillOval(x + padding, rowY - JBUI.scale(6), JBUI.scale(6), JBUI.scale(6));
            g.setColor(MUTED);
            g.drawString(labels[index], x + padding + dotAndGap, rowY);
            g.setColor(DashboardUi.PRIMARY);
            g.drawString(displayValues[index], x + tooltipWidth - padding
                    - rowMetrics.stringWidth(displayValues[index]), rowY);
        }
    }

    private void drawLegend(Graphics2D g, int left, int top, int availableWidth) {
        String[] labels = {"总量", "输入", "输出", "命中"};
        Color[] colors = {TOTAL, INPUT, OUTPUT, CACHE};
        g.setFont(chartFont(Font.PLAIN, -3f, 9f));
        FontMetrics metrics = g.getFontMetrics();
        int x = left;
        for (int index = 0; index < labels.length; index++) {
            int itemWidth = metrics.stringWidth(labels[index]) + JBUI.scale(24);
            if (x + itemWidth > left + availableWidth && index > 0) break;
            g.setColor(colors[index]);
            g.fillOval(x + JBUI.scale(2), top + JBUI.scale(7), JBUI.scale(7), JBUI.scale(7));
            g.setColor(MUTED);
            g.drawString(labels[index], x + JBUI.scale(13), top + JBUI.scale(15));
            x += itemWidth;
        }
    }

    private void drawEmptyState(Graphics2D g, int left, int top, int width, int height) {
        String title = "当前范围暂无趋势数据";
        String description = "切换时间范围或刷新本地数据";
        g.setColor(MUTED);
        g.setFont(chartFont(Font.BOLD, -1f, 11f));
        FontMetrics titleMetrics = g.getFontMetrics();
        int centerY = top + height / 2;
        g.drawString(title, left + (width - titleMetrics.stringWidth(title)) / 2, centerY - JBUI.scale(3));
        g.setColor(DashboardUi.SUBTLE);
        g.setFont(chartFont(Font.PLAIN, -3f, 9f));
        FontMetrics descriptionMetrics = g.getFontMetrics();
        g.drawString(description, left + (width - descriptionMetrics.stringWidth(description)) / 2, centerY + JBUI.scale(16));
    }

    private void drawFocusRing(Graphics2D g) {
        if (!hasFocus()) return;
        g.setColor(DashboardUi.ACCENT);
        g.setStroke(new BasicStroke(JBUIScale.scale(1.5f)));
        g.drawRoundRect(JBUI.scale(1), JBUI.scale(1), Math.max(0, getWidth() - JBUI.scale(3)),
                Math.max(0, getHeight() - JBUI.scale(3)), JBUI.scale(8), JBUI.scale(8));
    }

    private int indexAt(int mouseX) {
        if (points.isEmpty()) return -1;
        int left = getInsets().left + JBUI.scale(48);
        int width = getWidth() - left - getInsets().right - JBUI.scale(10);
        if (width <= 0 || mouseX < left || mouseX > left + width) return -1;
        if (points.size() == 1) return 0;
        int nearest = 0;
        double distance = Double.MAX_VALUE;
        for (int index = 0; index < points.size(); index++) {
            double next = Math.abs(mouseX - xFor(index, left, width));
            if (next < distance) { distance = next; nearest = index; }
        }
        return nearest;
    }

    private double xFor(int index, int left, int width) {
        if (points.size() == 1) return left + width / 2d;
        long first = points.getFirst().start();
        long last = points.getLast().start();
        if (first > 0 && last > first) return left + width * (points.get(index).start() - first) / (double) (last - first);
        return left + width * index / (double) (points.size() - 1);
    }

    private Font chartFont(int style, float delta, float minimum) {
        float size = Math.max(minimum, getFont().getSize2D() + delta);
        return getFont().deriveFont(style, size);
    }

    private static Color alpha(Color color, int alpha) {
        return new Color(color.getRed(), color.getGreen(), color.getBlue(), alpha);
    }

    private static double yFor(long value, long max, int top, int height) {
        return top + height - value * height / (double) max;
    }

    private String label(UsageSnapshot.TrendPoint point) {
        if (point.start() <= 0) return point.label();
        var instant = java.time.Instant.ofEpochMilli(point.start()).atZone(java.time.ZoneId.systemDefault());
        return hourly ? String.format("%02d:%02d", instant.getHour(), instant.getMinute())
                : String.format("%d/%d", instant.getMonthValue(), instant.getDayOfMonth());
    }

    private static String compact(long value) {
        if (value >= 1_000_000) return new DecimalFormat("0.0M").format(value / 1_000_000d);
        if (value >= 1_000) return new DecimalFormat("0.0K").format(value / 1_000d);
        return Long.toString(value);
    }

    private static String number(long value) { return new DecimalFormat("#,##0").format(value); }
}

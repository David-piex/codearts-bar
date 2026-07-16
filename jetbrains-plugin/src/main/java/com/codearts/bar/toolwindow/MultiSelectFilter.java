package com.codearts.bar.toolwindow;

import com.intellij.icons.AllIcons;
import com.intellij.ui.components.JBScrollPane;
import com.intellij.util.ui.JBUI;

import javax.swing.*;
import java.awt.*;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class MultiSelectFilter extends JButton {
    record Option(String value, String label) {}

    private final String allLabel;
    private final Map<String, String> options = new LinkedHashMap<>();
    private final Set<String> selected = new LinkedHashSet<>();
    private final JPopupMenu popup = new JPopupMenu();
    private Runnable onChange = () -> {};

    MultiSelectFilter(String allLabel) {
        super(allLabel, AllIcons.General.ChevronDown);
        this.allLabel = allLabel;
        setHorizontalTextPosition(SwingConstants.LEFT);
        setHorizontalAlignment(SwingConstants.LEFT);
        setIconTextGap(JBUI.scale(8));
        setMargin(JBUI.insets(4, 10));
        popup.setBorder(JBUI.Borders.customLine(DashboardUi.BORDER, 1));
        popup.setBackground(DashboardUi.SURFACE);
        addActionListener(event -> showOptions());
        updateLabel();
    }

    void setOnChange(Runnable next) {
        onChange = next == null ? () -> {} : next;
    }

    void setOptions(Collection<Option> next) {
        options.clear();
        if (next != null) {
            for (Option option : next) {
                if (option == null || option.value() == null || option.value().isBlank()) continue;
                options.putIfAbsent(option.value(), option.label() == null || option.label().isBlank() ? option.value() : option.label());
            }
        }
        selected.retainAll(options.keySet());
        updateLabel();
    }

    List<String> selectedValues() {
        return List.copyOf(selected);
    }

    void setSelectedValues(Collection<String> values) {
        selected.clear();
        if (values != null) for (String value : values) if (options.containsKey(value)) selected.add(value);
        updateLabel();
    }

    private void showOptions() {
        rebuildPopup();
        popup.show(this, 0, getHeight() + JBUI.scale(2));
    }

    private void rebuildPopup() {
        popup.removeAll();
        JPanel list = new JPanel();
        list.setLayout(new BoxLayout(list, BoxLayout.Y_AXIS));
        list.setBorder(JBUI.Borders.empty(5));
        list.setBackground(DashboardUi.SURFACE);

        JCheckBox all = optionBox(allLabel, selected.isEmpty());
        List<JCheckBox> optionBoxes = new ArrayList<>();
        all.addActionListener(event -> {
            selected.clear();
            for (JCheckBox box : optionBoxes) box.setSelected(false);
            all.setSelected(true);
            updateLabel();
            onChange.run();
        });
        list.add(all);

        for (Map.Entry<String, String> option : options.entrySet()) {
            JCheckBox box = optionBox(option.getValue(), selected.contains(option.getKey()));
            optionBoxes.add(box);
            box.addActionListener(event -> {
                if (box.isSelected()) selected.add(option.getKey());
                else selected.remove(option.getKey());
                all.setSelected(selected.isEmpty());
                updateLabel();
                onChange.run();
            });
            list.add(box);
        }

        JBScrollPane scroll = new JBScrollPane(list);
        scroll.setBorder(null);
        scroll.getViewport().setBackground(DashboardUi.SURFACE);
        scroll.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
        int rowHeight = Math.max(JBUI.scale(30), getPreferredSize().height);
        int rows = Math.min(9, Math.max(1, options.size() + 1));
        scroll.setPreferredSize(new Dimension(Math.max(getWidth(), JBUI.scale(192)), rowHeight * rows + JBUI.scale(10)));
        popup.add(scroll);
    }

    private static JCheckBox optionBox(String label, boolean checked) {
        JCheckBox box = new JCheckBox(label, checked);
        box.setBorder(JBUI.Borders.empty(5, 9));
        box.setBackground(DashboardUi.SURFACE);
        box.setOpaque(true);
        box.setAlignmentX(Component.LEFT_ALIGNMENT);
        return box;
    }

    private void updateLabel() {
        if (selected.isEmpty()) setText(allLabel);
        else if (selected.size() == 1) {
            String value = selected.iterator().next();
            setText(options.getOrDefault(value, value));
        } else setText("已选 " + selected.size() + " 项");
        setToolTipText(selected.isEmpty() ? allLabel : String.join("、", selected.stream().map(value -> options.getOrDefault(value, value)).toList()));
        getAccessibleContext().setAccessibleDescription(getToolTipText());
    }
}

package com.codearts.bar.model;

public final class QueryDisplayState {
    private String displayedLabel = "";

    public void markSuccess(String label) {
        displayedLabel = label == null ? "" : label.trim();
    }

    public boolean hasDisplayedResult() {
        return !displayedLabel.isEmpty();
    }

    public void reset() {
        displayedLabel = "";
    }

    public String failure(String requestedLabel, String error) {
        String requested = requestedLabel == null ? "" : requestedLabel.trim();
        String detail = error == null || error.isBlank() ? "未知错误" : error.trim();
        if (!hasDisplayedResult()) return requested + "加载失败：" + detail;
        return requested + "加载失败，仍显示" + displayedLabel + "：" + detail;
    }
}

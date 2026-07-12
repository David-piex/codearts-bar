package com.codearts.bar.model;

import java.util.regex.Pattern;

public final class SensitiveText {
    private static final Pattern ASSIGNMENT = Pattern.compile(
            "(?i)\\b(api[_-]?key|access[_-]?key|secret[_-]?key|token|password|passwd)"
                    + "(\\s*[:=]\\s*)([\\\"']?)([^\\s,;\\\"']+)([\\\"']?)");
    private static final Pattern AUTHORIZATION = Pattern.compile(
            "(?i)\\bauthorization(\\s*[:=]\\s*)(?:Bearer\\s+)?[^\\s,;]+(?=\\s|$)");
    private static final Pattern BEARER = Pattern.compile("(?i)\\bBearer\\s+[A-Za-z0-9._~+/=-]+");
    private static final Pattern PRIVATE_KEY = Pattern.compile(
            "(?is)-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----");

    private SensitiveText() { }

    public static String redact(String value) {
        if (value == null || value.isEmpty()) return value == null ? "" : value;
        String redacted = PRIVATE_KEY.matcher(value).replaceAll("[private key redacted]");
        redacted = AUTHORIZATION.matcher(redacted).replaceAll("Authorization$1[redacted]");
        redacted = BEARER.matcher(redacted).replaceAll("Bearer [redacted]");
        return ASSIGNMENT.matcher(redacted).replaceAll("$1$2[redacted]");
    }
}

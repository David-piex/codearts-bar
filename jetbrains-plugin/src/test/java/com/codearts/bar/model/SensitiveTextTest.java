package com.codearts.bar.model;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class SensitiveTextTest {
    @Test void redactsCommonCredentialAssignmentsWithoutHidingNormalWords() {
        String text = "调用服务 access_key: HIUAGK123, secret_key='hidden-value'，token = abc.def";
        String redacted = SensitiveText.redact(text);

        assertEquals("调用服务 access_key: [redacted], secret_key=[redacted]，token = [redacted]", redacted);
        assertEquals("Token 使用分析", SensitiveText.redact("Token 使用分析"));
    }

    @Test void redactsAuthorizationHeadersAndPrivateKeys() {
        assertEquals("Authorization: [redacted]", SensitiveText.redact("Authorization: Bearer abc.def-123"));
        assertEquals("Bearer [redacted]", SensitiveText.redact("Bearer abc.def-123"));
        assertFalse(SensitiveText.redact("-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----")
                .contains("secret"));
    }

    @Test void handlesEmptyValues() {
        assertEquals("", SensitiveText.redact(null));
        assertEquals("", SensitiveText.redact(""));
    }

    @Test void safeSummaryRemovesPathsStacksAndLimitsLength() {
        String value = "failure token=secret Bearer abc.def at C:\\Users\\private-user\\file.js and /home/private-linux/file.js "
                + "x".repeat(600) + "\nprivate-stack-frame";
        String summary = SensitiveText.safeSummary(value);
        assertFalse(summary.contains("secret"));
        assertFalse(summary.contains("private-user"));
        assertFalse(summary.contains("private-linux"));
        assertFalse(summary.contains("private-stack-frame"));
        assertTrue(summary.contains("[path]"));
        assertTrue(summary.length() <= 500);
    }
}

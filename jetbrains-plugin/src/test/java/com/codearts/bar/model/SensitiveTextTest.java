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
}

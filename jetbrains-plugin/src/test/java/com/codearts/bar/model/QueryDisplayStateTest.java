package com.codearts.bar.model;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class QueryDisplayStateTest {
    @Test void identifiesFailuresBeforeAnySuccessfulResult() {
        QueryDisplayState state = new QueryDisplayState();

        assertFalse(state.hasDisplayedResult());
        assertEquals("最近 7 天加载失败：超时", state.failure("最近 7 天", "超时"));
    }

    @Test void namesTheLastSuccessfulResultWhenAReplacementFails() {
        QueryDisplayState state = new QueryDisplayState();
        state.markSuccess("今天");

        assertTrue(state.hasDisplayedResult());
        assertEquals("最近 7 天加载失败，仍显示今天：数据库忙",
                state.failure("最近 7 天", "数据库忙"));
    }

    @Test void updatesOwnershipOnlyAfterSuccessAndNormalizesMissingErrors() {
        QueryDisplayState state = new QueryDisplayState();
        state.markSuccess(" 全部时间 ");

        assertEquals("自定义范围加载失败，仍显示全部时间：未知错误",
                state.failure("自定义范围", " "));
    }

    @Test void resetPreventsRetainingResultsFromAnotherDataSource() {
        QueryDisplayState state = new QueryDisplayState();
        state.markSuccess("今天");
        state.reset();

        assertFalse(state.hasDisplayedResult());
        assertEquals("最近 7 天加载失败：超时", state.failure("最近 7 天", "超时"));
    }
}

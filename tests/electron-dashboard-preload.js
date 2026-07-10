"use strict";

try {
  localStorage.clear();
  localStorage.setItem("workspaceMode", "analytics");
  localStorage.setItem("statsTableTab", "requests");
  localStorage.setItem("statsSource", "all");
  localStorage.setItem("statsRange", "all");
  localStorage.setItem("statsModel", "all");
  localStorage.setItem("layoutMode", "dashboard");
  localStorage.setItem("uiZoom", "1");
  localStorage.setItem("chartSeries", "total,input,output,cacheRead");
  localStorage.setItem("requestPageSize", "20");
  localStorage.setItem("sessionPageSize", "20");
} catch {}

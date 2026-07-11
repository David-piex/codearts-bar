(() => {
  const compact = new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const exact = new Intl.NumberFormat("zh-CN");
  const number = (value) =>
    Number.isFinite(Number(value)) ? Number(value) : 0;
  const token = (value) => compact.format(number(value));
  const percent = (value) => {
    if (value === null || value === undefined || value === "") return "\u2014";
    const n = Number(value);
    return Number.isFinite(n) ? `${n.toFixed(n >= 10 ? 0 : 1)}%` : "\u2014";
  };
  const milliseconds = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "\u2014";
    return n >= 1000
      ? `${(n / 1000).toFixed(n >= 10000 ? 1 : 2)}s`
      : `${Math.round(n)}ms`;
  };
  const bytes = (value) => {
    const n = number(value);
    if (!n) return "\u2014";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(3, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
  };
  const age = (value) => {
    const minutes = Math.floor(number(value) / 60000);
    if (minutes < 60) return `${Math.max(1, minutes)} \u5206\u949f\u524d`;
    const hours = Math.floor(minutes / 60);
    return hours < 48
      ? `${hours} \u5c0f\u65f6\u524d`
      : `${Math.floor(hours / 24)} \u5929\u524d`;
  };
  const html = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  window.CodeArtsFormat = Object.freeze({
    exact,
    number,
    token,
    percent,
    milliseconds,
    bytes,
    age,
    html,
  });
})();

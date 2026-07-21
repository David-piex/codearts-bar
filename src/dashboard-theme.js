(function installCodeArtsTheme(){
  const STORAGE_KEY = 'appearanceMode';
  const MODES = new Set(['system', 'light', 'dark']);
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const platform = String(window.codeartsApi?.platform || '');
  if(platform) document.documentElement.dataset.platform = platform;

  function storedMode(){
    try {
      const value = localStorage.getItem(STORAGE_KEY) || 'system';
      return MODES.has(value) ? value : 'system';
    } catch { return 'system'; }
  }

  function resolvedMode(mode = storedMode()){
    return mode === 'system' ? (media?.matches ? 'dark' : 'light') : mode;
  }

  function apply(mode = storedMode(), persist = false){
    const next = MODES.has(mode) ? mode : 'system';
    if(persist){
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    }
    const resolved = resolvedMode(next);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeMode = next;
    document.documentElement.style.colorScheme = resolved;
    window.dispatchEvent(new CustomEvent('codearts-theme-change', { detail: { mode: next, resolved } }));
    return resolved;
  }

  window.codeartsTheme = {
    mode: storedMode,
    resolved: () => resolvedMode(storedMode()),
    set: (mode) => apply(mode, true),
    apply: () => apply(storedMode(), false),
  };

  apply(storedMode(), false);
  media?.addEventListener?.('change', () => {
    if(storedMode() === 'system') apply('system', false);
  });
})();

'use strict';

(function attachTabHarborConfigSync(globalScope) {
  const {
    normalizeQuickShortcuts: apiNormalizeQuickShortcuts,
  } = globalScope.TabOutThemeControls || {};

  const {
    normalizeSavedTabSessions: apiNormalizeSavedTabSessions,
  } = globalScope.TabHarborTabSessions || {};

  const CONFIG_VERSION = 1;
  const STORAGE_KEYS = ['themePreferences', 'quickShortcuts', 'savedTabSessions'];

  function isValidConfigObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  async function exportConfig() {
    const data = await chrome.storage.local.get(STORAGE_KEYS);
    const config = {
      version: CONFIG_VERSION,
      exportedAt: new Date().toISOString(),
    };
    for (const key of STORAGE_KEYS) {
      config[key] = key in data ? data[key] : null;
    }
    if (Array.isArray(config.quickShortcuts)) {
      config.quickShortcuts = config.quickShortcuts.map(({ icon, iconKind, ...rest }) => rest);
    }
    return JSON.stringify(config, null, 2);
  }

  function validateImportData(parsed) {
    if (!isValidConfigObject(parsed)) {
      throw new Error('Invalid config: root must be an object');
    }
    const hasKey = STORAGE_KEYS.some(key => key in parsed);
    if (!hasKey) {
      throw new Error('Invalid config: missing recognized data keys');
    }
    if (parsed.quickShortcuts != null && !Array.isArray(parsed.quickShortcuts)) {
      throw new Error('Invalid config: quickShortcuts must be an array');
    }
    if (parsed.savedTabSessions != null && !Array.isArray(parsed.savedTabSessions)) {
      throw new Error('Invalid config: savedTabSessions must be an array');
    }
  }

  async function importConfig(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      throw new Error('Invalid file: not valid JSON');
    }

    validateImportData(parsed);

    const storagePayload = {};

    if (isValidConfigObject(parsed.themePreferences)) {
      storagePayload.themePreferences = parsed.themePreferences;
    }

    if (Array.isArray(parsed.quickShortcuts)) {
      const stripped = parsed.quickShortcuts.map(({ icon, iconKind, ...rest }) => rest);
      storagePayload.quickShortcuts = apiNormalizeQuickShortcuts
        ? apiNormalizeQuickShortcuts(stripped)
        : stripped;
    }

    if (Array.isArray(parsed.savedTabSessions)) {
      storagePayload.savedTabSessions = apiNormalizeSavedTabSessions
        ? apiNormalizeSavedTabSessions(parsed.savedTabSessions)
        : parsed.savedTabSessions;
    }

    if (Object.keys(storagePayload).length === 0) {
      throw new Error('Invalid config: no valid data to import');
    }

    await chrome.storage.local.set(storagePayload);

    return { importedKeys: Object.keys(storagePayload) };
  }

  const api = {
    CONFIG_VERSION,
    STORAGE_KEYS,
    exportConfig,
    importConfig,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabHarborConfigSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

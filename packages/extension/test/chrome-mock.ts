/* Minimal hand-written chrome.* mock for unit tests. Extend as needed; keep it dependency-free. */
type Listener = (...args: any[]) => any;
function event() {
  const listeners = new Set<Listener>();
  return {
    addListener: (l: Listener) => listeners.add(l),
    removeListener: (l: Listener) => listeners.delete(l),
    hasListener: (l: Listener) => listeners.has(l),
    emit: (...args: any[]) => [...listeners].map((l) => l(...args)),
  };
}
function storageArea() {
  let data: Record<string, any> = {};
  return {
    get: async (keys?: string | string[] | Record<string, any> | null) => {
      if (keys == null) return { ...data };
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out: Record<string, any> = {};
      for (const k of list) if (k in data) out[k] = data[k];
      if (keys && !Array.isArray(keys) && typeof keys === 'object') for (const k of Object.keys(keys)) if (!(k in out)) out[k] = keys[k];
      return out;
    },
    set: async (patch: Record<string, any>) => { Object.assign(data, patch); },
    remove: async (keys: string | string[]) => { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; },
    clear: async () => { data = {}; },
    _dump: () => data,
  };
}
export function installChromeMock() {
  const dynamicRules: any[] = [];
  const sessionRules: any[] = [];
  const chromeMock = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined as undefined | { message: string },
      getManifest: () => ({ version: '0.0.0', declarative_net_request: { rule_resources: [] } }),
      getURL: (p: string) => `chrome-extension://test-extension-id/${p.replace(/^\//, '')}`,
      sendMessage: (_msg: any, cb?: (r: any) => void) => cb?.({ ok: true, data: null }),
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
    },
    storage: { local: storageArea(), session: storageArea(), onChanged: event() },
    declarativeNetRequest: {
      getDynamicRules: async () => [...dynamicRules],
      updateDynamicRules: async (o: { removeRuleIds?: number[]; addRules?: any[] }) => {
        for (const id of o.removeRuleIds ?? []) { const i = dynamicRules.findIndex((r) => r.id === id); if (i >= 0) dynamicRules.splice(i, 1); }
        dynamicRules.push(...(o.addRules ?? []));
      },
      getSessionRules: async () => [...sessionRules],
      updateSessionRules: async (o: { removeRuleIds?: number[]; addRules?: any[] }) => {
        for (const id of o.removeRuleIds ?? []) { const i = sessionRules.findIndex((r) => r.id === id); if (i >= 0) sessionRules.splice(i, 1); }
        sessionRules.push(...(o.addRules ?? []));
      },
      getEnabledRulesets: async () => [] as string[],
      updateEnabledRulesets: async () => {},
      updateStaticRules: async () => {},
      getAvailableStaticRuleCount: async () => 330000,
      getMatchedRules: async () => ({ rulesMatchedInfo: [] }),
      isRegexSupported: async () => ({ isSupported: true }),
      MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
      MAX_NUMBER_OF_SESSION_RULES: 5000,
    },
    scripting: {
      insertCSS: async () => {},
      removeCSS: async () => {},
      executeScript: async () => [],
      registerContentScripts: async () => {},
      unregisterContentScripts: async () => {},
      getRegisteredContentScripts: async () => [],
      updateContentScripts: async () => {},
    },
    tabs: { query: async () => [], get: async () => ({}), onUpdated: event(), onRemoved: event(), onActivated: event() },
    webNavigation: { onCommitted: event(), onBeforeNavigate: event() },
    alarms: { create: () => {}, clear: async () => true, get: async () => undefined, onAlarm: event() },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    i18n: { getMessage: (k: string) => k, getUILanguage: () => 'en' },
  };
  (globalThis as any).chrome = chromeMock;
  return chromeMock;
}

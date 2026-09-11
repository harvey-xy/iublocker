/* Hand-written `chrome.*` mock for unit tests. Dependency-free on purpose. */
type Listener = (...args: any[]) => any;

export interface MockEvent {
  addListener: (l: Listener) => void;
  removeListener: (l: Listener) => void;
  hasListener: (l: Listener) => boolean;
  emit: (...args: any[]) => any[];
  listeners: () => Listener[];
}

function event(): MockEvent {
  const listeners = new Set<Listener>();
  return {
    addListener: (l: Listener) => void listeners.add(l),
    removeListener: (l: Listener) => void listeners.delete(l),
    hasListener: (l: Listener) => listeners.has(l),
    emit: (...args: any[]) => [...listeners].map((l) => l(...args)),
    listeners: () => [...listeners],
  };
}

function storageArea(areaName: string, onChanged: MockEvent) {
  let data: Record<string, any> = {};
  const fire = (changes: Record<string, any>) => {
    if (Object.keys(changes).length) onChanged.emit(changes, areaName);
  };
  return {
    get: async (keys?: string | string[] | Record<string, any> | null) => {
      if (keys == null) return { ...data };
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out: Record<string, any> = {};
      for (const k of list) if (k in data) out[k] = data[k];
      if (keys && !Array.isArray(keys) && typeof keys === 'object') {
        for (const k of Object.keys(keys)) if (!(k in out)) out[k] = (keys as Record<string, any>)[k];
      }
      return out;
    },
    set: async (patch: Record<string, any>) => {
      const changes: Record<string, any> = {};
      for (const [k, v] of Object.entries(patch)) {
        changes[k] = { oldValue: data[k], newValue: v };
        data[k] = v;
      }
      fire(changes);
    },
    remove: async (keys: string | string[]) => {
      const changes: Record<string, any> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (k in data) changes[k] = { oldValue: data[k] };
        delete data[k];
      }
      fire(changes);
    },
    clear: async () => {
      const changes: Record<string, any> = {};
      for (const k of Object.keys(data)) changes[k] = { oldValue: data[k] };
      data = {};
      fire(changes);
    },
    _dump: () => data,
    _seed: (patch: Record<string, any>) => {
      Object.assign(data, patch);
    },
  };
}

export interface InstallOptions {
  manifestVersion?: string;
  uiLanguage?: string;
  extensionId?: string;
  /** Static rulesets Chrome reports as enabled at install time. */
  enabledRulesets?: string[];
  availableStaticRuleCount?: number;
}

export type ChromeMock = ReturnType<typeof installChromeMock>;

export function installChromeMock(options: InstallOptions = {}) {
  const extensionId = options.extensionId ?? 'test-extension-id';
  const dynamicRules: any[] = [];
  const sessionRules: any[] = [];
  const enabledRulesets = new Set<string>(options.enabledRulesets ?? []);
  const disabledStaticRules = new Map<string, Set<number>>();
  const registeredScripts: any[] = [];
  const alarms = new Map<string, any>();
  const tabs = new Map<number, any>();
  const badges = new Map<number, string>();
  const onChanged = event();

  const calls = {
    insertCSS: [] as any[],
    executeScript: [] as any[],
    registerContentScripts: [] as any[],
    updateContentScripts: [] as any[],
    unregisterContentScripts: [] as any[],
    updateStaticRules: [] as any[],
    updateEnabledRulesets: [] as any[],
    getMatchedRules: [] as any[],
    sendMessage: [] as any[],
    setBadgeText: [] as any[],
  };

  let matchedRules: any[] = [];

  const chromeMock = {
    runtime: {
      id: extensionId,
      lastError: undefined as undefined | { message: string },
      getManifest: () => ({
        version: options.manifestVersion ?? '0.0.0',
        declarative_net_request: { rule_resources: [] },
      }),
      getURL: (p: string) => `chrome-extension://${extensionId}/${p.replace(/^\//, '')}`,
      sendMessage: (msg: any, cb?: (r: any) => void) => {
        calls.sendMessage.push(msg);
        if (cb) cb({ ok: true, data: null });
        return Promise.resolve({ ok: true, data: null });
      },
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
    },
    storage: {
      local: storageArea('local', onChanged),
      session: storageArea('session', onChanged),
      onChanged,
    },
    declarativeNetRequest: {
      getDynamicRules: async () => [...dynamicRules],
      updateDynamicRules: async (o: { removeRuleIds?: number[]; addRules?: any[] }) => {
        for (const id of o.removeRuleIds ?? []) {
          const i = dynamicRules.findIndex((r) => r.id === id);
          if (i >= 0) dynamicRules.splice(i, 1);
        }
        dynamicRules.push(...(o.addRules ?? []));
      },
      getSessionRules: async () => [...sessionRules],
      updateSessionRules: async (o: { removeRuleIds?: number[]; addRules?: any[] }) => {
        for (const id of o.removeRuleIds ?? []) {
          const i = sessionRules.findIndex((r) => r.id === id);
          if (i >= 0) sessionRules.splice(i, 1);
        }
        sessionRules.push(...(o.addRules ?? []));
      },
      getEnabledRulesets: async () => [...enabledRulesets],
      updateEnabledRulesets: async (o: { enableRulesetIds?: string[]; disableRulesetIds?: string[] }) => {
        calls.updateEnabledRulesets.push(o);
        for (const id of o.disableRulesetIds ?? []) enabledRulesets.delete(id);
        for (const id of o.enableRulesetIds ?? []) enabledRulesets.add(id);
      },
      updateStaticRules: async (o: {
        rulesetId: string;
        disableRuleIds?: number[];
        enableRuleIds?: number[];
      }) => {
        calls.updateStaticRules.push(o);
        const set = disabledStaticRules.get(o.rulesetId) ?? new Set<number>();
        for (const id of o.disableRuleIds ?? []) set.add(id);
        for (const id of o.enableRuleIds ?? []) set.delete(id);
        disabledStaticRules.set(o.rulesetId, set);
      },
      getDisabledRuleIds: async (o: { rulesetId: string }) => [
        ...(disabledStaticRules.get(o.rulesetId) ?? []),
      ],
      getAvailableStaticRuleCount: async () => options.availableStaticRuleCount ?? 330000,
      getMatchedRules: async (filter?: any) => {
        calls.getMatchedRules.push(filter ?? null);
        const min = filter?.minTimeStamp ?? 0;
        return { rulesMatchedInfo: matchedRules.filter((m) => (m.timeStamp ?? 0) >= min) };
      },
      isRegexSupported: async () => ({ isSupported: true }),
      onRuleMatchedDebug: event(),
      MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
      MAX_NUMBER_OF_SESSION_RULES: 5000,
    },
    scripting: {
      insertCSS: async (injection: any) => {
        calls.insertCSS.push(injection);
      },
      removeCSS: async () => {},
      executeScript: async (injection: any) => {
        calls.executeScript.push(injection);
        return [];
      },
      registerContentScripts: async (scripts: any[]) => {
        calls.registerContentScripts.push(scripts);
        registeredScripts.push(...scripts);
      },
      unregisterContentScripts: async (filter?: { ids?: string[] }) => {
        calls.unregisterContentScripts.push(filter ?? null);
        const ids = filter?.ids;
        for (let i = registeredScripts.length - 1; i >= 0; i--) {
          if (!ids || ids.includes(registeredScripts[i].id)) registeredScripts.splice(i, 1);
        }
      },
      getRegisteredContentScripts: async () => registeredScripts.map((s) => ({ ...s })),
      updateContentScripts: async (scripts: any[]) => {
        calls.updateContentScripts.push(scripts);
        for (const script of scripts) {
          const i = registeredScripts.findIndex((s) => s.id === script.id);
          if (i >= 0) registeredScripts[i] = { ...registeredScripts[i], ...script };
        }
      },
    },
    tabs: {
      query: async () => [...tabs.values()],
      get: async (tabId: number) => {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        return tab;
      },
      onUpdated: event(),
      onRemoved: event(),
      onActivated: event(),
    },
    webNavigation: { onCommitted: event(), onBeforeNavigate: event() },
    alarms: {
      create: (name: string, info: any) => {
        alarms.set(name, { name, ...info });
      },
      clear: async (name: string) => alarms.delete(name),
      get: async (name: string) => alarms.get(name),
      getAll: async () => [...alarms.values()],
      onAlarm: event(),
    },
    action: {
      setBadgeText: async (details: { tabId?: number; text: string }) => {
        calls.setBadgeText.push(details);
        if (typeof details.tabId === 'number') badges.set(details.tabId, details.text);
      },
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
    i18n: {
      getMessage: (k: string) => k,
      getUILanguage: () => options.uiLanguage ?? 'en',
    },

    /* ------------------------------------------------------------- test helpers -- */
    _state: {
      dynamicRules,
      sessionRules,
      enabledRulesets,
      disabledStaticRules,
      registeredScripts,
      alarms,
      tabs,
      badges,
      calls,
      setMatchedRules(rules: any[]) {
        matchedRules = rules;
      },
      addTab(tab: { id: number; url: string; [k: string]: any }) {
        tabs.set(tab.id, tab);
        return tab;
      },
      badge(tabId: number) {
        return badges.get(tabId);
      },
    },
  };

  (globalThis as any).chrome = chromeMock;
  return chromeMock;
}

/** Convenience for tests: a fresh mock installed on `globalThis`. */
export function resetChromeMock(options: InstallOptions = {}): ChromeMock {
  return installChromeMock(options);
}

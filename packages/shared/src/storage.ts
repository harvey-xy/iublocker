import type { SiteMode } from './modes';
import type { DNRRule } from './dnr';
import type { CosmeticDB } from './cosmetic';
import type { ScriptletDB } from './scriptlets';

export const SCHEMA_VERSION = 1;

export interface Settings {
  defaultMode: SiteMode;
  showBadgeCount: boolean;
  autoUpdate: boolean;
  updateIntervalHours: number;
  updateChannel: 'stable' | 'nightly';
  collapseBlockedElements: boolean;
  cloudDeltaBaseUrl: string;
  theme: 'auto' | 'light' | 'dark';
  advanced: {
    logMatchedRules: boolean;
    allowTrustedUserScriptlets: boolean;
  };
}

export const DEFAULT_CLOUD_DELTA_BASE_URL = 'https://raw.githubusercontent.com/harvey-xy/iublocker/rulesets';

export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'optimal',
  showBadgeCount: true,
  autoUpdate: true,
  updateIntervalHours: 6,
  updateChannel: 'stable',
  collapseBlockedElements: true,
  cloudDeltaBaseUrl: DEFAULT_CLOUD_DELTA_BASE_URL,
  theme: 'auto',
  advanced: { logMatchedRules: false, allowTrustedUserScriptlets: false },
};

export interface UserCompiled {
  dnr: DNRRule[];
  cosmetic: CosmeticDB;
  scriptlets: ScriptletDB;
  warnings: string[];
}

export interface AppliedDelta {
  base: string;
  version: string;
  appliedAt: number;
  cosmetic: CosmeticDB;
  scriptlets: ScriptletDB;
  disabled: Record<string, number[]>;
}

export interface UpdaterState {
  lastCheck: number;
  lastSuccess: number;
  lastError?: string;
  etag?: string;
}

export interface Stats {
  since: number;
  blockedTotal: number;
  perDay: Record<string, number>;
}

/** Keys and value types of chrome.storage.local. docs/STORAGE.md */
export interface LocalStorageSchema {
  schemaVersion: number;
  settings: Settings;
  siteModes: Record<string, SiteMode>;
  lists: Record<string, { enabled: boolean }>;
  userFiltersText: string;
  userCompiled: UserCompiled | null;
  delta: AppliedDelta | null;
  updater: UpdaterState;
  stats: Stats;
  pickerDrafts: Record<string, string[]>;
}

export interface MatchedRuleSummary {
  ruleId: number;
  rulesetId: string;
  url?: string;
  type?: string;
  time: number;
}

export interface TabSessionState {
  hostname: string;
  blocked: number;
  lastUrl: string;
  matched?: MatchedRuleSummary[];
}

export const tabSessionKey = (tabId: number) => `tab:${tabId}` as const;
export const pickerActiveKey = (tabId: number) => `pickerActive:${tabId}` as const;

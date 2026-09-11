/**
 * Minimal, dependency-free mirror of chrome.declarativeNetRequest types so the compiler
 * stays isomorphic (Node + browser) without depending on @types/chrome.
 * Keep in sync with https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
 */
export type DNRResourceType =
  | 'main_frame'
  | 'sub_frame'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'object'
  | 'xmlhttprequest'
  | 'ping'
  | 'csp_report'
  | 'media'
  | 'websocket'
  | 'webtransport'
  | 'webbundle'
  | 'other';

export const DNR_RESOURCE_TYPES: readonly DNRResourceType[] = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
];

export type DNRRequestMethod = 'connect' | 'delete' | 'get' | 'head' | 'options' | 'patch' | 'post' | 'put' | 'other';

export type DNRDomainType = 'firstParty' | 'thirdParty';

export type DNRHeaderOperation = 'append' | 'set' | 'remove';

export interface DNRHeaderInfo {
  header: string;
  values?: string[];
  excludedValues?: string[];
}

export interface DNRModifyHeaderInfo {
  header: string;
  operation: DNRHeaderOperation;
  value?: string;
}

export interface DNRQueryTransform {
  removeParams?: string[];
  addOrReplaceParams?: { key: string; value: string; replaceOnly?: boolean }[];
}

export interface DNRURLTransform {
  scheme?: string;
  host?: string;
  port?: string;
  path?: string;
  query?: string;
  queryTransform?: DNRQueryTransform;
  fragment?: string;
  username?: string;
  password?: string;
}

export interface DNRRedirect {
  extensionPath?: string;
  url?: string;
  regexSubstitution?: string;
  transform?: DNRURLTransform;
}

export type DNRActionType = 'block' | 'redirect' | 'allow' | 'upgradeScheme' | 'modifyHeaders' | 'allowAllRequests';

export interface DNRAction {
  type: DNRActionType;
  redirect?: DNRRedirect;
  requestHeaders?: DNRModifyHeaderInfo[];
  responseHeaders?: DNRModifyHeaderInfo[];
}

export interface DNRCondition {
  urlFilter?: string;
  regexFilter?: string;
  isUrlFilterCaseSensitive?: boolean;
  initiatorDomains?: string[];
  excludedInitiatorDomains?: string[];
  requestDomains?: string[];
  excludedRequestDomains?: string[];
  resourceTypes?: DNRResourceType[];
  excludedResourceTypes?: DNRResourceType[];
  requestMethods?: DNRRequestMethod[];
  excludedRequestMethods?: DNRRequestMethod[];
  domainType?: DNRDomainType;
  tabIds?: number[];
  excludedTabIds?: number[];
  responseHeaders?: DNRHeaderInfo[];
  excludedResponseHeaders?: DNRHeaderInfo[];
}

export interface DNRRule {
  id: number;
  priority?: number;
  action: DNRAction;
  condition: DNRCondition;
}

/** Fixed priority tiers. docs/FILTER-SYNTAX.md §4 */
export const PRIORITY = {
  BLOCK: 1,
  ALLOW: 2,
  IMPORTANT: 3,
  DOCUMENT_ALLOW: 4,
  USER_BLOCK: 10,
  USER_ALLOW: 11,
  USER_IMPORTANT: 12,
  TEMPORARY: 1000,
  SITE_OFF: 1_000_000,
} as const;

/** Rule ID ranges. docs/FILTER-SYNTAX.md §6 */
export const ID_RANGE = {
  STATIC: { start: 1, end: 299_999 },
  DELTA: { start: 300_000, end: 319_999 },
  USER: { start: 320_000, end: 329_999 },
  SITE: { start: 330_000, end: 334_999 },
  TEMP: { start: 335_000, end: 335_999 },
} as const;

/** Chrome platform limits we design against (Chrome ≥ 128). */
export const DNR_LIMITS = {
  MAX_STATIC_RULESETS: 100,
  MAX_ENABLED_STATIC_RULESETS: 50,
  GLOBAL_STATIC_RULES: 330_000,
  GUARANTEED_STATIC_RULES: 30_000,
  MAX_REGEX_RULES_PER_RULESET: 1_000,
  MAX_DYNAMIC_RULES: 30_000,
  MAX_UNSAFE_DYNAMIC_RULES: 5_000,
  MAX_SESSION_RULES: 5_000,
  MAX_DISABLED_STATIC_RULES_PER_RULESET: 5_000,
} as const;

/** Build-time budgets stricter than Chrome's. docs/RULESETS.md §3 */
export const BUILD_BUDGET = {
  STATIC_RULES_DEFAULT_ENABLED: 300_000,
  STATIC_RULES_PER_LIST: 150_000,
  DELTA_DYNAMIC_RULES: 20_000,
  SCRIPTLET_GROUP_BYTES: 8 * 1024 * 1024,
} as const;

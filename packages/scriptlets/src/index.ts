/**
 * @iublocker/scriptlets — MAIN-world scriptlet library (workstream T3).
 * The exports below are the frozen public API (docs/SCRIPTLETS.md §1, §2).
 */
import type { ScriptletRegistryJSON } from '@iublocker/shared';
import type { ScriptletDefinition } from './_define';

export type { ScriptletDefinition, ScriptletSpec } from './_define';
export { defineScriptlet, serializeScriptletFn } from './_define';

import abortCurrentScript from './abort-current-script';
import abortOnPropertyRead from './abort-on-property-read';
import abortOnPropertyWrite from './abort-on-property-write';
import abortOnStackTrace from './abort-on-stack-trace';
import adjustSetInterval from './adjust-setInterval';
import adjustSetTimeout from './adjust-setTimeout';
import disableNewtabLinks from './disable-newtab-links';
import jsonPrune from './json-prune';
import jsonPruneFetchResponse from './json-prune-fetch-response';
import jsonPruneXhrResponse from './json-prune-xhr-response';
import nanoSetIntervalBooster from './nano-setInterval-booster';
import nanoSetTimeoutBooster from './nano-setTimeout-booster';
import noFetchIf from './no-fetch-if';
import noSetIntervalIf from './no-setInterval-if';
import noSetTimeoutIf from './no-setTimeout-if';
import noXhrIf from './no-xhr-if';
import noevalIf from './noeval-if';
import preventAddEventListener from './prevent-addEventListener';
import preventRequestAnimationFrame from './prevent-requestAnimationFrame';
import preventWindowOpen from './prevent-window-open';
import removeAttr from './remove-attr';
import removeClass from './remove-class';
import removeCookie from './remove-cookie';
import removeNodeText from './remove-node-text';
import replaceNodeText from './replace-node-text';
import setAttr from './set-attr';
import setConstant from './set-constant';
import setCookie from './set-cookie';
import setCookieReload from './set-cookie-reload';
import setLocalStorageItem from './set-local-storage-item';
import setSessionStorageItem from './set-session-storage-item';
import trustedReplaceFetchResponse from './trusted-replace-fetch-response';
import trustedReplaceXhrResponse from './trusted-replace-xhr-response';
import trustedSetConstant from './trusted-set-constant';
import trustedSetCookie from './trusted-set-cookie';
import trustedSetLocalStorageItem from './trusted-set-local-storage-item';

import addthisWidget from './surrogates/addthis-widget';
import amazonAds from './surrogates/amazon-ads';
import ampprojectV0 from './surrogates/ampproject-v0';
import chartbeat from './surrogates/chartbeat';
import doubleclickInstreamAdStatus from './surrogates/doubleclick-instream-ad-status';
import fuckadblock from './surrogates/fuckadblock';
import googleAnalyticsAnalytics from './surrogates/google-analytics-analytics';
import googleAnalyticsCxApi from './surrogates/google-analytics-cx-api';
import googleAnalyticsGa from './surrogates/google-analytics-ga';
import googlesyndicationAdsbygoogle from './surrogates/googlesyndication-adsbygoogle';
import googletagmanagerGtm from './surrogates/googletagmanager-gtm';
import googletagservicesGpt from './surrogates/googletagservices-gpt';
import hdMain from './surrogates/hd-main';
import ligatusAngularTag from './surrogates/ligatus-angular-tag';
import monkeybroker from './surrogates/monkeybroker';
import nobab from './surrogates/nobab';
import nofab from './surrogates/nofab';
import outbrainWidget from './surrogates/outbrain-widget';
import popads from './surrogates/popads';
import popadsDummy from './surrogates/popads-dummy';
import prebidAds from './surrogates/prebid-ads';
import scorecardresearchBeacon from './surrogates/scorecardresearch-beacon';

/** Every scriptlet, in declaration order. */
const definitions: ScriptletDefinition[] = [
  abortCurrentScript,
  abortOnPropertyRead,
  abortOnPropertyWrite,
  abortOnStackTrace,
  adjustSetInterval,
  adjustSetTimeout,
  disableNewtabLinks,
  jsonPrune,
  jsonPruneFetchResponse,
  jsonPruneXhrResponse,
  nanoSetIntervalBooster,
  nanoSetTimeoutBooster,
  noFetchIf,
  noSetIntervalIf,
  noSetTimeoutIf,
  noXhrIf,
  noevalIf,
  preventAddEventListener,
  preventRequestAnimationFrame,
  preventWindowOpen,
  removeAttr,
  removeClass,
  removeCookie,
  removeNodeText,
  replaceNodeText,
  setAttr,
  setConstant,
  setCookie,
  setCookieReload,
  setLocalStorageItem,
  setSessionStorageItem,
  trustedReplaceFetchResponse,
  trustedReplaceXhrResponse,
  trustedSetConstant,
  trustedSetCookie,
  trustedSetLocalStorageItem,
  addthisWidget,
  amazonAds,
  ampprojectV0,
  chartbeat,
  doubleclickInstreamAdStatus,
  fuckadblock,
  googleAnalyticsAnalytics,
  googleAnalyticsCxApi,
  googleAnalyticsGa,
  googlesyndicationAdsbygoogle,
  googletagmanagerGtm,
  googletagservicesGpt,
  hdMain,
  ligatusAngularTag,
  monkeybroker,
  nobab,
  nofab,
  outbrainWidget,
  popads,
  popadsDummy,
  prebidAds,
  scorecardresearchBeacon,
];

/** Canonical name → definition. */
export const registry: Record<string, ScriptletDefinition> = {};
for (const def of definitions) {
  registry[def.name] = def;
}

/** Resolve by canonical name or alias. */
export function resolveScriptlet(nameOrAlias: string): ScriptletDefinition | undefined {
  const n = nameOrAlias.endsWith('.js') ? nameOrAlias.slice(0, -3) : nameOrAlias;
  if (registry[n]) return registry[n];
  for (const def of Object.values(registry)) if (def.aliases.includes(n)) return def;
  return undefined;
}

/** Static (non-surrogate) redirect resources: every accepted name → file. */
const staticResources: Record<string, string> = {
  'noop.js': 'noop.js',
  noopjs: 'noop.js',
  'noop.txt': 'noop.txt',
  nooptext: 'noop.txt',
  'noop.css': 'noop.css',
  noopcss: 'noop.css',
  'noop.html': 'noop.html',
  noopframe: 'noop.html',
  'noop-0.1s.mp3': 'noop-0.1s.mp3',
  'noopmp3-0.1s': 'noop-0.1s.mp3',
  'noop-1s.mp4': 'noop-1s.mp4',
  'noopmp4-1s': 'noop-1s.mp4',
  '1x1.gif': '1x1.gif',
  '1x1-transparent.gif': '1x1.gif',
  '2x2.png': '2x2.png',
  '2x2-transparent.png': '2x2.png',
  '3x2.png': '3x2.png',
  '3x2-transparent.png': '3x2.png',
  '32x32.png': '32x32.png',
  '32x32-transparent.png': '32x32.png',
  empty: 'empty',
  'click2load.html': 'click2load.html',
  click2load: 'click2load.html',
  // ABP `$rewrite=abp-resource:` spellings (ABP-syntax lists use these names).
  'blank-text': 'noop.txt',
  'blank-css': 'noop.css',
  'blank-js': 'noop.js',
  'blank-html': 'noop.html',
  'blank-mp3': 'noop-0.1s.mp3',
  'blank-mp4': 'noop-1s.mp4',
  'blank-gif': '1x1.gif',
  '1x1-transparent-gif': '1x1.gif',
  '2x2-transparent-png': '2x2.png',
  '3x2-transparent-png': '3x2.png',
  '32x32-transparent-png': '32x32.png',
};

/** uBO's long-form `$redirect=` spellings for the surrogates. */
const surrogateAliases: Record<string, string[]> = {
  'googletagservices_gpt.js': [
    'googletagservices.com/gpt.js',
    'googletagservices.com/tag/js/gpt.js',
    'googletagservices.com/tag/js/gpt_mobile.js',
  ],
  'google-analytics_ga.js': ['google-analytics.com/ga.js'],
  'google-analytics_analytics.js': ['google-analytics.com/analytics.js', 'googletagmanager.com/analytics.js'],
  'google-analytics_cx_api.js': ['google-analytics.com/cx/api.js'],
  'googletagmanager_gtm.js': ['googletagmanager.com/gtm.js', 'googletagmanager_gtm.js'],
  'googlesyndication_adsbygoogle.js': [
    'googlesyndication.com/adsbygoogle.js',
    'googlesyndication_adsbygoogle.js',
  ],
  'doubleclick_instream_ad_status.js': ['doubleclick.net/instream/ad_status.js'],
  'amazon_ads.js': ['amazon-adsystem.com/aax2/amzn_ads.js'],
  'ampproject_v0.js': ['ampproject.org/v0.js'],
  'scorecardresearch_beacon.js': ['scorecardresearch.com/beacon.js'],
  'monkeybroker.js': ['d3pkae9owd2lcf.cloudfront.net/mb105.js'],
  'outbrain-widget.js': ['widgets.outbrain.com/outbrain.js'],
  'chartbeat.js': ['static.chartbeat.com/js/chartbeat.js'],
  'addthis_widget.js': ['addthis.com/addthis_widget.js'],
  'ligatus_angular-tag.js': ['ligatus.com/*/angular-tag.js'],
  'popads.js': ['popads.net.js'],
  'nobab.js': ['bab-defuser.js', 'prevent-bab.js'],
};

/** $redirect resource name (and aliases) → path under /resources/. */
export const redirectResources: Record<string, string> = {};
for (const [name, file] of Object.entries(staticResources)) {
  redirectResources[name] = `resources/${file}`;
}
for (const def of definitions) {
  const file = def.redirectResource;
  if (file === undefined) continue;
  const names = [def.name, ...def.aliases, ...(surrogateAliases[def.name] ?? [])];
  for (const name of names) {
    redirectResources[name] = `resources/${file}`;
  }
}

export function registryJSON(): ScriptletRegistryJSON {
  return {
    version: 1,
    scriptlets: Object.values(registry).map(({ fn: _fn, ...meta }) => meta),
    redirectResources,
  };
}

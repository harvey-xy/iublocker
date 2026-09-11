/**
 * User filters. docs/ARCHITECTURE.md §6 "Runtime pipeline for user filters".
 *
 * The dashboard stores raw text; every save recompiles it with the browser build of the
 * compiler, rewrites the dynamic user rule range and refreshes the cosmetic/scriptlet
 * indexes. Nothing is evaluated: scriptlet *arguments* are data, bodies are bundled.
 */
import type { UserCompiled, UserFiltersResponse } from '@iublocker/shared';
import { compileUserFilters } from './compiler-api';
import * as cosmeticIndex from './cosmetic/index';
import { errorMessage, log } from './log';
import { broadcast } from './messaging/broadcast';
import { RANGES, rewriteRange } from './rulesets/dynamic';
import * as scriptletIndex from './scriptlets/index';
import { getSettings } from './settings';
import * as store from './storage/store';

function counts(compiled: UserCompiled | null): UserFiltersResponse['counts'] {
  return {
    dnr: compiled?.dnr.length ?? 0,
    cosmetic: compiled ? Object.keys(compiled.cosmetic.specific ?? {}).length : 0,
    scriptlets: compiled ? Object.keys(compiled.scriptlets.byHost ?? {}).length : 0,
  };
}

export async function getUserFilters(): Promise<UserFiltersResponse> {
  const [text, compiled] = await Promise.all([store.get('userFiltersText'), store.get('userCompiled')]);
  return { text, warnings: compiled?.warnings ?? [], counts: counts(compiled) };
}

export async function setUserFilters(text: string): Promise<UserFiltersResponse> {
  const settings = await getSettings();
  const allowTrusted = settings.advanced.allowTrustedUserScriptlets;
  let compiled: UserCompiled;
  const warnings: string[] = [];
  try {
    compiled = compileUserFilters(text, { trusted: allowTrusted, allowTrustedScriptlets: allowTrusted });
  } catch (err) {
    log.error('compileUserFilters failed', err);
    throw new Error(`could not compile user filters: ${errorMessage(err)}`);
  }
  warnings.push(...(compiled.warnings ?? []));

  const rewrite = await rewriteRange(RANGES.user, compiled.dnr ?? []);
  warnings.push(...rewrite.warnings);

  const stored: UserCompiled = { ...compiled, warnings };
  await store.set({ userFiltersText: text, userCompiled: stored });

  cosmeticIndex.invalidate();
  scriptletIndex.invalidate();
  broadcast({ type: 'event:userFiltersChanged' });
  log.info(`user filters: ${rewrite.added} dynamic rule(s), ${warnings.length} warning(s)`);
  return { text, warnings, counts: counts(stored) };
}

/** Append lines (picker / popup); duplicates and blanks are ignored. */
export async function addUserFilters(lines: readonly string[]): Promise<UserFiltersResponse> {
  const text = await store.get('userFiltersText');
  const existing = new Set(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
  const additions = lines.map((line) => line.trim()).filter((line) => line.length > 0 && !existing.has(line));
  if (additions.length === 0) return getUserFilters();
  const next =
    text.length === 0 ? additions.join('\n') : `${text.replace(/\n+$/, '')}\n${additions.join('\n')}`;
  return setUserFilters(next);
}

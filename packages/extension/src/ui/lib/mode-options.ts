import type { ListGroup, SiteMode } from '@iublocker/shared';
import { SITE_MODES } from '@iublocker/shared';
import { t } from './i18n';
import type { SegmentedOption } from './components';

export function modeLabel(mode: SiteMode): string {
  return t(`mode_${mode}`);
}

export function modeDescription(mode: SiteMode): string {
  return t(`mode_${mode}_desc`);
}

/** Segmented-control options for the four site modes, marking the configured default. */
export function modeOptions(defaultMode?: SiteMode): SegmentedOption<SiteMode>[] {
  return SITE_MODES.map((mode) => ({
    value: mode,
    label: modeLabel(mode),
    description: modeDescription(mode),
    ...(mode === defaultMode ? { marker: t('mode_default_marker') } : {}),
  }));
}

export const LIST_GROUP_ORDER: readonly ListGroup[] = [
  'ads',
  'privacy',
  'malware',
  'annoyances',
  'regional',
  'custom',
  'test',
];

export function listGroupTitle(group: ListGroup): string {
  return t(`group_${group}`);
}

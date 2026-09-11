/** Per-site blocking mode. See docs/ARCHITECTURE.md §5. */
export type SiteMode = 'off' | 'basic' | 'optimal' | 'complete';

export const SITE_MODES: readonly SiteMode[] = ['off', 'basic', 'optimal', 'complete'];

export const SITE_MODE_LEVEL: Record<SiteMode, number> = { off: 0, basic: 1, optimal: 2, complete: 3 };

export const DEFAULT_SITE_MODE: SiteMode = 'optimal';

export function modeAtLeast(mode: SiteMode, min: SiteMode): boolean {
  return SITE_MODE_LEVEL[mode] >= SITE_MODE_LEVEL[min];
}

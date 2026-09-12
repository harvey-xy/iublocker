import { useState } from 'preact/hooks';
import type { Settings } from '@iublocker/shared';
import { sendRequest } from '@iublocker/shared';
import { Card, ErrorBox, Field, Segmented, Spinner, Toggle } from '../../lib/components';
import { errorMessage, useRequest } from '../../lib/useRequest';
import { modeOptions } from '../../lib/mode-options';
import { applyTheme } from '../../lib/theme';
import { isHttpsUrl } from '../../lib/links';
import { t } from '../../lib/i18n';

const CHANNELS: Settings['updateChannel'][] = ['stable', 'nightly'];
const THEMES: Settings['theme'][] = ['auto', 'light', 'dark'];

export function SettingsTab() {
  const settings = useRequest(() => ({ type: 'settings:get' }) as const, []);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState<string | null>(null);

  const data = settings.data;

  const save = async (patch: Partial<Settings>) => {
    setError(null);
    try {
      const next = await sendRequest({ type: 'settings:set', patch });
      settings.set(next);
      applyTheme(next.theme);
      // The worker sanitises what it stores; show what was stored, not what was typed.
      if (patch.cloudDeltaBaseUrl !== undefined) setUrlDraft(null);
      setNote(t('settings_saved'));
    } catch (err) {
      setError(t('settings_save_failed', [errorMessage(err)]));
    }
  };

  /** `settings:set` silently falls back to the default for anything but https. */
  const saveCloudUrl = (raw: string) => {
    const value = raw.trim();
    if (!isHttpsUrl(value)) {
      setNote(null);
      setError(t('settings_cloud_base_url_invalid'));
      return;
    }
    void save({ cloudDeltaBaseUrl: value });
  };

  if (settings.loading && !data) return <Spinner />;
  if (!data) return <ErrorBox error={settings.error ?? t('common_error')} onRetry={settings.reload} />;

  return (
    <div class="stack">
      <Card title={t('settings_general')}>
        <Field label={t('settings_default_mode')} description={t('settings_default_mode_desc')}>
          {() => (
            <Segmented
              name="default-mode"
              legend={t('settings_default_mode')}
              value={data.defaultMode}
              options={modeOptions()}
              onChange={(defaultMode) => void save({ defaultMode })}
            />
          )}
        </Field>
        <Toggle
          name="showBadgeCount"
          checked={data.showBadgeCount}
          onChange={(showBadgeCount) => void save({ showBadgeCount })}
          label={t('settings_show_badge')}
        />
        <Toggle
          name="collapseBlockedElements"
          checked={data.collapseBlockedElements}
          onChange={(collapseBlockedElements) => void save({ collapseBlockedElements })}
          label={t('settings_collapse')}
        />
      </Card>

      <Card title={t('settings_updates')}>
        <Toggle
          name="autoUpdate"
          checked={data.autoUpdate}
          onChange={(autoUpdate) => void save({ autoUpdate })}
          label={t('settings_auto_update')}
        />
        <Field label={t('settings_update_interval')}>
          {(id) => (
            <input
              id={id}
              class="input input-narrow"
              type="number"
              min={1}
              max={168}
              step={1}
              data-testid="updateIntervalHours"
              value={String(data.updateIntervalHours)}
              onChange={(e) => {
                const raw = Number.parseInt((e.currentTarget as HTMLInputElement).value, 10);
                if (Number.isFinite(raw)) void save({ updateIntervalHours: Math.min(168, Math.max(1, raw)) });
              }}
            />
          )}
        </Field>
        <Field label={t('settings_update_channel')}>
          {(id) => (
            <select
              id={id}
              class="select"
              data-testid="updateChannel"
              value={data.updateChannel}
              onChange={(e) =>
                void save({
                  updateChannel: (e.currentTarget as HTMLSelectElement).value as Settings['updateChannel'],
                })
              }
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`channel_${c}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </Card>

      <Card title={t('settings_appearance')}>
        <Field label={t('settings_theme')}>
          {(id) => (
            <select
              id={id}
              class="select"
              data-testid="theme"
              value={data.theme}
              onChange={(e) =>
                void save({ theme: (e.currentTarget as HTMLSelectElement).value as Settings['theme'] })
              }
            >
              {THEMES.map((theme) => (
                <option key={theme} value={theme}>
                  {t(`theme_${theme}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </Card>

      <Card title={t('settings_advanced')}>
        <Toggle
          name="logMatchedRules"
          checked={data.advanced.logMatchedRules}
          onChange={(logMatchedRules) => void save({ advanced: { ...data.advanced, logMatchedRules } })}
          label={t('settings_log_matched')}
        />
        <Toggle
          name="allowTrustedUserScriptlets"
          checked={data.advanced.allowTrustedUserScriptlets}
          onChange={(allowTrustedUserScriptlets) =>
            void save({ advanced: { ...data.advanced, allowTrustedUserScriptlets } })
          }
          label={t('settings_allow_trusted_scriptlets')}
          description={t('settings_allow_trusted_scriptlets_desc')}
        />
        <Field label={t('settings_cloud_base_url')} description={t('settings_cloud_base_url_desc')}>
          {(id) => (
            <input
              id={id}
              class="input mono"
              type="url"
              spellcheck={false}
              data-testid="cloudDeltaBaseUrl"
              value={urlDraft ?? data.cloudDeltaBaseUrl}
              onInput={(e) => setUrlDraft((e.currentTarget as HTMLInputElement).value)}
              onChange={(e) => saveCloudUrl((e.currentTarget as HTMLInputElement).value)}
            />
          )}
        </Field>
      </Card>

      {note && (
        <p class="ok" role="status">
          {note}
        </p>
      )}
      {error && <ErrorBox error={error} />}
    </div>
  );
}

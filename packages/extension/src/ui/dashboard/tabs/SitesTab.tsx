import { useEffect, useState } from 'preact/hooks';
import type { SiteMode } from '@iublocker/shared';
import { SITE_MODES, isValidHostname, sendRequest } from '@iublocker/shared';
import { Button, Card, ErrorBox, Spinner } from '../../lib/components';
import { errorMessage, useRequest } from '../../lib/useRequest';
import { modeLabel } from '../../lib/mode-options';
import { t } from '../../lib/i18n';

/**
 * The router has no dedicated `sites:get` request, so the overrides table is read from
 * `debug:dumpState`. See the T6 report: a `sites:get` request would remove this coupling.
 */
export function readSiteModes(
  dump: Record<string, unknown> | null | undefined,
): Record<string, SiteMode> | null {
  if (!dump || typeof dump !== 'object') return null;
  const raw = (dump as { siteModes?: unknown }).siteModes;
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, SiteMode> = {};
  for (const [hostname, mode] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof mode === 'string' && (SITE_MODES as readonly string[]).includes(mode))
      out[hostname] = mode as SiteMode;
  }
  return out;
}

export function SitesTab() {
  const dump = useRequest(() => ({ type: 'debug:dumpState' }) as const, []);
  const [overrides, setOverrides] = useState<Record<string, SiteMode> | null>(null);
  const [draftHost, setDraftHost] = useState('');
  const [draftMode, setDraftMode] = useState<SiteMode>('off');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (dump.data && overrides === null) setOverrides(readSiteModes(dump.data) ?? {});
  }, [dump.data, overrides]);

  if (dump.loading && !dump.data) return <Spinner />;
  if (!dump.data) return <ErrorBox error={dump.error ?? t('common_error')} onRetry={dump.reload} />;

  const table = overrides ?? readSiteModes(dump.data);
  const unavailable = table === null;
  const rows = Object.entries(table ?? {}).sort(([a], [b]) => a.localeCompare(b));

  const setMode = async (hostname: string, mode: SiteMode | null) => {
    setBusy(true);
    setError(null);
    try {
      await sendRequest({ type: 'site:setMode', hostname, mode });
      setOverrides((prev) => {
        const next = { ...(prev ?? {}) };
        if (mode === null) delete next[hostname];
        else next[hostname] = mode;
        return next;
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const hostname = draftHost
      .trim()
      .toLowerCase()
      .replace(/^\.+|\.+$/g, '');
    if (!hostname || !isValidHostname(hostname)) {
      setError(t('sites_invalid_hostname'));
      return;
    }
    if (table && hostname in table) {
      setError(t('sites_duplicate'));
      return;
    }
    await setMode(hostname, draftMode);
    setDraftHost('');
  };

  return (
    <div class="stack">
      <Card title={t('sites_title')} description={t('sites_desc')}>
        {unavailable && <p class="warn">{t('sites_unavailable')}</p>}
        {error && <ErrorBox error={error} />}
        <table class="table" data-testid="sites-table">
          <thead>
            <tr>
              <th scope="col">{t('sites_col_hostname')}</th>
              <th scope="col">{t('sites_col_mode')}</th>
              <th scope="col">{t('sites_col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} class="muted">
                  {t('sites_empty')}
                </td>
              </tr>
            )}
            {rows.map(([hostname, mode]) => (
              <tr key={hostname}>
                <td class="mono">{hostname}</td>
                <td>
                  <select
                    class="select"
                    value={mode}
                    disabled={busy}
                    aria-label={`${t('sites_col_mode')} — ${hostname}`}
                    data-site={hostname}
                    onChange={(e) =>
                      void setMode(hostname, (e.currentTarget as HTMLSelectElement).value as SiteMode)
                    }
                  >
                    {SITE_MODES.map((m) => (
                      <option key={m} value={m}>
                        {modeLabel(m)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <Button
                    variant="danger"
                    disabled={busy}
                    aria-label={t('sites_remove', [hostname])}
                    onClick={() => void setMode(hostname, null)}
                  >
                    {t('common_remove')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <input
                  class="input mono"
                  type="text"
                  value={draftHost}
                  placeholder={t('sites_add_placeholder')}
                  aria-label={t('sites_col_hostname')}
                  data-testid="sites-add-host"
                  onInput={(e) => setDraftHost((e.currentTarget as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void add();
                  }}
                />
              </td>
              <td>
                <select
                  class="select"
                  value={draftMode}
                  aria-label={t('sites_col_mode')}
                  data-testid="sites-add-mode"
                  onChange={(e) => setDraftMode((e.currentTarget as HTMLSelectElement).value as SiteMode)}
                >
                  {SITE_MODES.map((m) => (
                    <option key={m} value={m}>
                      {modeLabel(m)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <Button variant="primary" disabled={busy} onClick={() => void add()}>
                  {t('sites_add')}
                </Button>
              </td>
            </tr>
          </tfoot>
        </table>
      </Card>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { MatchedRuleSummary } from '@iublocker/shared';
import { sendRequest } from '@iublocker/shared';
import { Button, Card, ErrorBox } from '../lib/components';
import { errorMessage } from '../lib/useRequest';
import { formatClock, formatCount, shortenUrl } from '../lib/format';
import { useTheme } from '../lib/theme';
import { t } from '../lib/i18n';

export const REFRESH_MS = 2000;

export function parseTabId(search: string): number | null {
  const raw = new URLSearchParams(search).get('tabId');
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function matches(row: MatchedRuleSummary, needle: string): boolean {
  if (needle === '') return true;
  return (
    (row.url ?? '').toLowerCase().includes(needle) ||
    (row.type ?? '').toLowerCase().includes(needle) ||
    row.rulesetId.toLowerCase().includes(needle) ||
    String(row.ruleId).includes(needle)
  );
}

export function Logger({ tabId }: { tabId?: number | null }) {
  const resolvedTabId = useMemo(
    () => (tabId === undefined ? parseTabId(typeof location === 'undefined' ? '' : location.search) : tabId),
    [tabId],
  );
  const [rows, setRows] = useState<MatchedRuleSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState('');
  useTheme();

  useEffect(() => {
    if (resolvedTabId === null || paused) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await sendRequest({ type: 'logger:get', tabId: resolvedTabId });
        if (!stopped) {
          setRows(res.matched);
          setError(null);
        }
      } catch (err) {
        if (!stopped) setError(errorMessage(err));
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [resolvedTabId, paused]);

  const needle = query.trim().toLowerCase();
  const visible = rows.filter((row) => matches(row, needle));

  if (resolvedTabId === null) {
    return (
      <div class="logger">
        <Card title={t('logger_title')}>
          <p>{t('logger_no_tab')}</p>
        </Card>
      </div>
    );
  }

  return (
    <div class="logger">
      <Card
        title={`${t('logger_title')} — ${t('logger_tab', [resolvedTabId])}`}
        description={t('logger_hint')}
        actions={
          <Button variant={paused ? 'primary' : 'default'} onClick={() => setPaused((p) => !p)}>
            {paused ? t('logger_resume') : t('logger_pause')}
          </Button>
        }
      >
        <div class="row-between">
          <input
            class="input"
            type="search"
            data-testid="logger-filter"
            aria-label={t('logger_filter_placeholder')}
            placeholder={t('logger_filter_placeholder')}
            value={query}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          />
          <span class="muted" data-testid="logger-count">
            {t('logger_rows', [formatCount(visible.length), formatCount(rows.length)])}
          </span>
        </div>
        {paused && (
          <p class="muted" role="status">
            {t('logger_paused')}
          </p>
        )}
        {error && <ErrorBox error={error} />}
        <div class="table-scroll">
          <table class="table logger-table" data-testid="logger-table">
            <thead>
              <tr>
                <th scope="col">{t('logger_col_time')}</th>
                <th scope="col">{t('logger_col_type')}</th>
                <th scope="col">{t('logger_col_url')}</th>
                <th scope="col">{t('logger_col_ruleset')}</th>
                <th scope="col">{t('logger_col_rule')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} class="muted">
                    {t('logger_empty')}
                  </td>
                </tr>
              )}
              {visible.map((row, i) => (
                <tr key={`${row.time}-${row.rulesetId}-${row.ruleId}-${i}`}>
                  <td class="mono nowrap">{formatClock(row.time)}</td>
                  <td class="mono">{row.type ?? '—'}</td>
                  <td class="mono url" title={row.url ?? ''}>
                    {row.url ? shortenUrl(row.url) : '—'}
                  </td>
                  <td class="mono">{row.rulesetId}</td>
                  <td class="mono nowrap">{row.ruleId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

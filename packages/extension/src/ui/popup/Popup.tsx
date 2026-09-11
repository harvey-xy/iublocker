import { useCallback, useEffect, useState } from 'preact/hooks';
import type { SiteMode } from '@iublocker/shared';
import { sendRequest } from '@iublocker/shared';
import { Button, ErrorBox, Segmented, Spinner } from '../lib/components';
import { errorMessage, useExtensionEvent, useRequest } from '../lib/useRequest';
import { formatCount } from '../lib/format';
import { modeOptions } from '../lib/mode-options';
import { t } from '../lib/i18n';
import { useTheme } from '../lib/theme';

function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '0.0.0';
  }
}

export function Popup() {
  /** `undefined` while the active tab is being resolved, `null` when there is none. */
  const [activeTabId, setActiveTabId] = useState<number | null | undefined>(undefined);
  const [needsReload, setNeedsReload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(chrome.tabs.query({ active: true, currentWindow: true })).then(
      (tabs) => {
        if (!cancelled) setActiveTabId(tabs[0]?.id ?? null);
      },
      () => {
        if (!cancelled) setActiveTabId(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const tab = useRequest(
    () =>
      activeTabId === undefined ? null : ({ type: 'tab:getState', tabId: activeTabId ?? undefined } as const),
    [activeTabId],
  );
  const settings = useRequest(() => ({ type: 'settings:get' }) as const, []);
  const stats = useRequest(() => ({ type: 'stats:get' }) as const, []);
  const lists = useRequest(() => ({ type: 'lists:get' }) as const, []);

  useTheme(settings.data?.theme);

  useExtensionEvent(
    useCallback(
      (event) => {
        if (event.type === 'event:listsUpdated') {
          setUpdating(false);
          setUpdateNote(event.ok ? t('popup_update_done') : (event.error ?? t('popup_update_failed')));
          lists.reload();
        }
      },
      [lists.reload],
    ),
  );

  const state = tab.data;
  const setMode = async (mode: SiteMode | null) => {
    if (!state || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await sendRequest({ type: 'site:setMode', hostname: state.hostname, mode });
      tab.set({ ...state, mode, effectiveMode: res.effectiveMode });
      setNeedsReload(true);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const pickElement = async () => {
    if (!state) return;
    try {
      await sendRequest({ type: 'picker:start', tabId: state.tabId });
      window.close();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const openDashboard = () => {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    window.close();
  };

  const openLogger = () => {
    if (!state) return;
    chrome.tabs.create({ url: chrome.runtime.getURL(`logger.html?tabId=${state.tabId}`) });
    window.close();
  };

  const reloadPage = () => {
    if (!state) return;
    chrome.tabs.reload(state.tabId);
    window.close();
  };

  const updateLists = async () => {
    setUpdating(true);
    setUpdateNote(t('popup_updating'));
    try {
      await sendRequest({ type: 'lists:update' });
    } catch (err) {
      setUpdating(false);
      setUpdateNote(errorMessage(err));
    }
  };

  if (tab.loading && !state) return <Spinner />;
  if (!state) return <ErrorBox error={tab.error ?? t('common_error')} onRetry={tab.reload} />;

  const totalBlocked = stats.data?.blockedTotal ?? 0;
  const deltaVersion = lists.data?.deltaVersion;

  return (
    <div class="popup">
      <header class="pop-head">
        <img
          class="pop-logo"
          src={state.effectiveMode === 'off' ? 'icons/32-off.png' : 'icons/32.png'}
          alt=""
          width="32"
          height="32"
        />
        <div class="pop-ident">
          <h1 class="pop-host" title={state.isInternal ? t('popup_internal_page') : state.hostname}>
            {state.isInternal ? t('popup_internal_page') : state.hostname || t('common_unknown')}
          </h1>
          <p class="pop-sub">
            {state.isInternal ? t('popup_internal_hint') : t('popup_lists_enabled', [state.listsEnabled])}
          </p>
        </div>
      </header>

      <section class="pop-counts">
        <div class="pop-count">
          <strong class="pop-count-value">{formatCount(state.blockedCount)}</strong>
          <span class="pop-count-label">{t('popup_blocked_tab')}</span>
        </div>
        <div class="pop-count">
          <strong class="pop-count-value">{formatCount(totalBlocked)}</strong>
          <span class="pop-count-label">{t('popup_blocked_total')}</span>
        </div>
      </section>

      {!state.isInternal && (
        <section class="pop-modes">
          <Segmented
            name="site-mode"
            legend={
              state.hostname ? t('popup_mode_legend', [state.hostname]) : t('popup_mode_legend_generic')
            }
            value={state.effectiveMode}
            options={modeOptions(settings.data?.defaultMode)}
            onChange={(mode) => void setMode(mode)}
            disabled={busy}
          />
          {state.mode !== null && (
            <div class="pop-override">
              <span>{t('popup_site_override')}</span>
              <Button variant="ghost" onClick={() => void setMode(null)} disabled={busy}>
                {t('popup_reset_default')}
              </Button>
            </div>
          )}
        </section>
      )}

      {needsReload && (
        <div class="pop-notice" role="status">
          <span>{t('popup_reload_hint')}</span>
          <Button variant="primary" onClick={reloadPage}>
            {t('popup_reload_to_apply')}
          </Button>
        </div>
      )}

      {actionError && <ErrorBox error={actionError} />}

      <section class="pop-actions">
        {!state.isInternal && <Button onClick={() => void pickElement()}>{t('popup_pick_element')}</Button>}
        <Button onClick={openDashboard}>{t('popup_open_dashboard')}</Button>
        {!state.isInternal && (
          <Button variant="ghost" onClick={openLogger}>
            {t('popup_open_logger')}
          </Button>
        )}
      </section>

      <footer class="pop-foot">
        <span class="pop-versions">
          {t('popup_version', [extensionVersion()])}
          {lists.data && ` · ${t('popup_lists_version', [lists.data.rulesetVersion])}`}
          {lists.data &&
            ` · ${deltaVersion ? t('popup_delta_version', [deltaVersion]) : t('popup_delta_none')}`}
        </span>
        <Button variant="ghost" onClick={() => void updateLists()} disabled={updating}>
          {updating ? t('popup_updating') : t('popup_update_lists')}
        </Button>
      </footer>
      {updateNote && (
        <p class="pop-updatenote" role="status">
          {updateNote}
        </p>
      )}
    </div>
  );
}

import { useEffect, useState } from 'preact/hooks';
import { ListsTab } from './tabs/ListsTab';
import { FiltersTab } from './tabs/FiltersTab';
import { SitesTab } from './tabs/SitesTab';
import { SettingsTab } from './tabs/SettingsTab';
import { AboutTab } from './tabs/AboutTab';
import { useTheme } from '../lib/theme';
import { t } from '../lib/i18n';

const TAB_IDS = ['lists', 'filters', 'sites', 'settings', 'about'] as const;
export type TabId = (typeof TAB_IDS)[number];

function tabFromHash(hash: string): TabId {
  const id = hash.replace(/^#/, '');
  return (TAB_IDS as readonly string[]).includes(id) ? (id as TabId) : 'lists';
}

async function openLogger(): Promise<void> {
  let tabId: number | undefined;
  try {
    const tabs = await Promise.resolve(chrome.tabs.query({ active: true, lastFocusedWindow: true }));
    tabId = tabs[0]?.id;
  } catch {
    tabId = undefined;
  }
  const url = chrome.runtime.getURL(tabId === undefined ? 'logger.html' : `logger.html?tabId=${tabId}`);
  chrome.tabs.create({ url });
}

export function Dashboard() {
  const [tab, setTab] = useState<TabId>(() => tabFromHash(location.hash));
  useTheme();

  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash(location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const label: Record<TabId, string> = {
    lists: t('tab_lists'),
    filters: t('tab_filters'),
    sites: t('tab_sites'),
    settings: t('tab_settings'),
    about: t('tab_about'),
  };

  return (
    <div class="dash">
      <header class="dash-head">
        <img class="dash-logo" src="icons/48.png" alt="" width="32" height="32" />
        <h1 class="dash-title">{t('dash_title')}</h1>
      </header>

      <nav class="dash-nav" aria-label={t('dash_title')}>
        <ul class="dash-tabs" role="tablist">
          {TAB_IDS.map((id) => (
            <li key={id} role="presentation">
              <a
                class="dash-tab"
                role="tab"
                href={`#${id}`}
                id={`tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
              >
                {label[id]}
              </a>
            </li>
          ))}
          <li role="presentation">
            <button class="dash-tab dash-tab-link" type="button" onClick={() => void openLogger()}>
              {t('tab_logger')} ↗
            </button>
          </li>
        </ul>
      </nav>

      <main
        class="dash-main"
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        tabIndex={-1}
      >
        {tab === 'lists' && <ListsTab />}
        {tab === 'filters' && <FiltersTab />}
        {tab === 'sites' && <SitesTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'about' && <AboutTab />}
      </main>
    </div>
  );
}

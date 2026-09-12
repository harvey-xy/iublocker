import { useState } from 'preact/hooks';
import { sendRequest } from '@iublocker/shared';
import { Button, Card, ErrorBox } from '../../lib/components';
import { errorMessage, useRequest } from '../../lib/useRequest';
import { LICENSE_URL, REPO_URL, safeHttpUrl } from '../../lib/links';
import { t } from '../../lib/i18n';

function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '0.0.0';
  }
}

export function AboutTab() {
  const lists = useRequest(() => ({ type: 'lists:get' }) as const, []);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copyDiagnostics = async () => {
    setError(null);
    setNote(null);
    try {
      const state = await sendRequest({ type: 'debug:dumpState' });
      const payload = {
        generatedAt: new Date().toISOString(),
        extensionVersion: extensionVersion(),
        rulesetVersion: lists.data?.rulesetVersion ?? null,
        deltaVersion: lists.data?.deltaVersion ?? null,
        userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
        state,
      };
      const text = JSON.stringify(payload, null, 2);
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setNote(t('about_copied'));
    } catch (err) {
      setError(t('about_copy_failed', [errorMessage(err)]));
    }
  };

  const licensed = (lists.data?.lists ?? []).filter((list) => list.license);

  return (
    <div class="stack">
      <Card
        title={t('about_title')}
        description={t('about_copy_diagnostics_note')}
        actions={
          <Button variant="primary" onClick={() => void copyDiagnostics()}>
            {t('about_copy_diagnostics')}
          </Button>
        }
      >
        <dl class="kv">
          <dt>{t('about_version')}</dt>
          <dd class="mono">{extensionVersion()}</dd>
          <dt>{t('about_ruleset_version')}</dt>
          <dd class="mono">{lists.data?.rulesetVersion ?? '—'}</dd>
          <dt>{t('about_delta_version')}</dt>
          <dd class="mono">{lists.data?.deltaVersion ?? '—'}</dd>
        </dl>
        {note && (
          <p class="ok" role="status">
            {note}
          </p>
        )}
        {error && <ErrorBox error={error} />}
      </Card>

      <Card title={t('about_license')}>
        <p>{t('about_license_notice')}</p>
        <p>
          <a href={LICENSE_URL} target="_blank" rel="noreferrer noopener">
            GNU GPL v3.0-or-later
          </a>
          {' · '}
          <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
            {t('about_source')}
          </a>
        </p>
      </Card>

      <Card title={t('about_list_licenses')}>
        {licensed.length === 0 ? (
          <p class="muted">{t('lists_empty')}</p>
        ) : (
          <ul class="plain">
            {licensed.map((list) => (
              <li key={list.id}>
                <span>{list.title}</span> — <span class="muted">{list.license}</span>
                {safeHttpUrl(list.homepage) && (
                  <>
                    {' · '}
                    <a href={safeHttpUrl(list.homepage) ?? ''} target="_blank" rel="noreferrer noopener">
                      {t('lists_homepage')}
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

import { useEffect, useState } from 'preact/hooks';
import { sendRequest } from '@iublocker/shared';
import { Button, Card, ErrorBox, Spinner } from '../../lib/components';
import { errorMessage, useRequest } from '../../lib/useRequest';
import { formatCount } from '../../lib/format';
import { FILTER_SYNTAX_URL } from '../../lib/links';
import { t } from '../../lib/i18n';

export function FiltersTab() {
  const user = useRequest(() => ({ type: 'filters:getUser' }) as const, []);
  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user.data && text === null) setText(user.data.text);
  }, [user.data, text]);

  if (user.loading && !user.data) return <Spinner />;
  if (!user.data) return <ErrorBox error={user.error ?? t('common_error')} onRetry={user.reload} />;

  const value = text ?? user.data.text;
  const lineCount = value === '' ? 0 : value.split('\n').length;
  const dirty = value !== user.data.text;

  const apply = async () => {
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      const res = await sendRequest({ type: 'filters:setUser', text: value });
      user.set(res);
      setText(res.text);
      setNote(t('filters_applied'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const { warnings, counts } = user.data;

  return (
    <div class="stack">
      <Card
        title={t('filters_title')}
        description={t('filters_desc')}
        actions={
          <Button variant="primary" onClick={() => void apply()} disabled={saving || !dirty}>
            {t('filters_apply')}
          </Button>
        }
      >
        <textarea
          class="filters-area"
          spellcheck={false}
          autocomplete="off"
          autocapitalize="off"
          aria-label={t('filters_title')}
          placeholder={t('filters_placeholder')}
          value={value}
          onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
        />
        <div class="row-between">
          <span class="muted" data-testid="filters-lines">
            {t('filters_lines', [formatCount(lineCount)])}
          </span>
          <span class="muted">
            {t('filters_counts', [
              formatCount(counts.dnr),
              formatCount(counts.cosmetic),
              formatCount(counts.scriptlets),
            ])}
          </span>
        </div>
        {note && (
          <p class="ok" role="status">
            {note}
          </p>
        )}
        {error && <ErrorBox error={error} />}
        <p>
          <a href={FILTER_SYNTAX_URL} target="_blank" rel="noreferrer noopener">
            {t('filters_syntax_help')}
          </a>
        </p>
      </Card>

      <Card title={t('filters_warnings')}>
        {warnings.length === 0 ? (
          <p class="muted">{t('filters_no_warnings')}</p>
        ) : (
          <ul class="warnings">
            {warnings.map((warning, i) => (
              <li key={`${i}-${warning}`} class="warn">
                {warning}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

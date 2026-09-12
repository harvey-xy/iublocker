import { useCallback, useState } from 'preact/hooks';
import type { ListGroup, ListsGetResponse } from '@iublocker/shared';
import { sendRequest } from '@iublocker/shared';
import { Button, Card, ErrorBox, Meter, Spinner, Toggle } from '../../lib/components';
import { errorMessage, useExtensionEvent, useRequest } from '../../lib/useRequest';
import { formatCount, formatTime } from '../../lib/format';
import { LIST_GROUP_ORDER, listGroupTitle } from '../../lib/mode-options';
import { safeHttpUrl } from '../../lib/links';
import { t } from '../../lib/i18n';

type ListEntry = ListsGetResponse['lists'][number];

function groupLists(lists: readonly ListEntry[]): [ListGroup, ListEntry[]][] {
  const byGroup = new Map<ListGroup, ListEntry[]>();
  for (const list of lists) {
    const bucket = byGroup.get(list.group);
    if (bucket) bucket.push(list);
    else byGroup.set(list.group, [list]);
  }
  const ordered: [ListGroup, ListEntry[]][] = [];
  for (const group of LIST_GROUP_ORDER) {
    const bucket = byGroup.get(group);
    if (bucket) {
      ordered.push([group, bucket]);
      byGroup.delete(group);
    }
  }
  for (const [group, bucket] of byGroup) ordered.push([group, bucket]);
  return ordered;
}

export function ListsTab() {
  const lists = useRequest(() => ({ type: 'lists:get' }) as const, []);
  const [pending, setPending] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useExtensionEvent(
    useCallback(
      (event) => {
        if (event.type !== 'event:listsUpdated') return;
        setUpdating(false);
        setNote(
          event.ok ? `${t('popup_update_done')} · ${event.version}` : (event.error ?? t('common_error')),
        );
        lists.reload();
      },
      [lists.reload],
    ),
  );

  const data = lists.data;

  const toggle = async (listId: string, enabled: boolean) => {
    if (!data) return;
    setPending(listId);
    setError(null);
    try {
      const res = await sendRequest({ type: 'lists:setEnabled', listId, enabled });
      lists.set({
        ...data,
        lists: data.lists.map((l) => (l.id === listId ? { ...l, enabled: res.enabled } : l)),
        budget: res.budget,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const updateNow = async () => {
    setUpdating(true);
    setNote(t('lists_updating'));
    setError(null);
    try {
      await sendRequest({ type: 'lists:update' });
    } catch (err) {
      setUpdating(false);
      setError(errorMessage(err));
    }
  };

  if (lists.loading && !data) return <Spinner />;
  if (!data) return <ErrorBox error={lists.error ?? t('common_error')} onRetry={lists.reload} />;

  const { budget, updater } = data;
  const budgetLabel = t('lists_budget_summary', [
    formatCount(budget.used),
    formatCount(budget.total),
    formatCount(budget.available),
  ]);

  return (
    <div class="stack">
      <Card
        title={t('lists_budget_title')}
        actions={
          <Button variant="primary" onClick={() => void updateNow()} disabled={updating}>
            {updating ? t('lists_updating') : t('lists_update_now')}
          </Button>
        }
      >
        <Meter value={budget.used} max={budget.total} label={budgetLabel} />
        <p class="muted">{budgetLabel}</p>
        {budget.available < budget.total * 0.05 && <p class="warn">{t('lists_budget_full')}</p>}
        <dl class="kv">
          <dt>{t('lists_ruleset_version')}</dt>
          <dd>{data.rulesetVersion}</dd>
          <dt>{t('lists_delta_version')}</dt>
          <dd>{data.deltaVersion ?? '—'}</dd>
        </dl>
        <p class="muted">{t('lists_last_check', [formatTime(updater.lastCheck)])}</p>
        <p class="muted">{t('lists_last_success', [formatTime(updater.lastSuccess)])}</p>
        {updater.lastError && (
          <p class="warn" role="alert">
            {t('lists_last_error', [updater.lastError])}
          </p>
        )}
        {note && (
          <p class="muted" role="status">
            {note}
          </p>
        )}
        {error && <ErrorBox error={error} />}
      </Card>

      {data.lists.length === 0 && <Card title={t('lists_title')}>{t('lists_empty')}</Card>}

      {groupLists(data.lists).map(([group, entries]) => (
        <Card key={group} title={listGroupTitle(group)}>
          <ul class="list-group">
            {entries.map((list) => (
              <li class="list-item" key={list.id}>
                <Toggle
                  name={list.id}
                  checked={list.enabled}
                  disabled={pending === list.id}
                  onChange={(enabled) => void toggle(list.id, enabled)}
                  label={list.title}
                  description={
                    <>
                      <span>
                        {t('lists_counts', [
                          formatCount(list.counts.dnr),
                          formatCount(
                            list.counts.cosmeticSpecific +
                              list.counts.cosmeticGeneric +
                              list.counts.procedural,
                          ),
                          formatCount(list.counts.scriptlets),
                        ])}
                      </span>
                      {safeHttpUrl(list.homepage) && (
                        <>
                          {' · '}
                          <a href={safeHttpUrl(list.homepage) ?? ''} target="_blank" rel="noreferrer noopener">
                            {t('lists_homepage')}
                          </a>
                        </>
                      )}
                      {list.license && <span class="muted"> · {t('lists_license', [list.license])}</span>}
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

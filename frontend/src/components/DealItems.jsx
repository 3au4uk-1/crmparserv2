import {
  useUpdateItemSyncOverride,
  useResetSyncOverrides,
  useAddItemToBlacklist,
  useAddItemToRestoration,
} from '../api';

const classColors = {
  keyword_match: 'bg-pastel-green-bg/50 border-l-2 border-pastel-green-text',
  llm_confirmed: 'bg-pastel-blue-bg/50 border-l-2 border-pastel-blue-text',
  llm_rejected: 'bg-surface-muted',
  unclassified: 'bg-surface-muted',
};

const classLabels = {
  keyword_match: 'Ключевое слово',
  llm_confirmed: 'LLM: да',
  llm_rejected: 'LLM: нет',
  unclassified: 'Не определено',
};

export default function DealItems({ dealId, items, readOnly = false }) {
  const updateOverride = useUpdateItemSyncOverride();
  const resetOverrides = useResetSyncOverrides();
  const addToBlacklist = useAddItemToBlacklist();
  const addToRestoration = useAddItemToRestoration();

  if (!items?.length) {
    return <p className="text-sm text-ink-muted py-2">Позиций в заказе нет</p>;
  }

  const eligibleCount = items.filter((i) => i.eligibleForTwenty).length;

  function syncLabel(item) {
    if (item.syncMode === 'manual') return 'вручную';
    if (item.blacklisted) return 'блеклист';
    return 'авто';
  }

  function handleCheckboxChange(item, checked) {
    updateOverride.mutate({
      dealId,
      itemId: item.id,
      syncOverride: checked ? 'include' : 'exclude',
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-ink-muted">
          В Twenty:{' '}
          <strong className="text-ink tabular-nums">{eligibleCount}</strong>
          {' '}из{' '}
          <strong className="text-ink tabular-nums">{items.length}</strong>
        </span>
        {!readOnly && (
          <button
            onClick={() => resetOverrides.mutate(dealId)}
            disabled={resetOverrides.isPending}
            className="text-xs text-pastel-blue-text hover:opacity-80 disabled:opacity-50 transition-opacity"
          >
            Сбросить к авто
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="data-table">
          <thead>
            <tr className="bg-surface-muted">
              <th className="w-24">В Twenty</th>
              <th>Название</th>
              <th>Цена</th>
              <th>Кол-во</th>
              <th>Классификация</th>
              {!readOnly && <th className="w-36">Действия</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className={classColors[item.classification] || ''}>
                <td onClick={(e) => e.stopPropagation()}>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(item.eligibleForTwenty)}
                      disabled={readOnly || updateOverride.isPending}
                      onChange={(e) => handleCheckboxChange(item, e.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="text-xs text-ink-faint">{syncLabel(item)}</span>
                  </label>
                </td>
                <td className="font-medium">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{item.name}</span>
                    {item.restorationMatch && item.eligibleForTwenty && (
                      <span className="text-xs bg-pastel-yellow-bg text-pastel-yellow-text px-1.5 py-0.5 rounded">
                        реставрация · 0 ₽
                      </span>
                    )}
                  </div>
                </td>
                <td className="tabular-nums">{item.price?.toLocaleString('ru-RU')} ₽</td>
                <td className="tabular-nums">{item.quantity}</td>
                <td>
                  <span className="text-xs">{classLabels[item.classification] || item.classification}</span>
                </td>
                {!readOnly && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-col gap-1">
                      {item.blacklisted ? (
                        <span className="text-xs text-pastel-red-text">блеклист</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addToBlacklist.mutate({ dealId, itemId: item.id })}
                          disabled={addToBlacklist.isPending}
                          className="text-xs text-pastel-red-text hover:opacity-80 disabled:opacity-50 text-left"
                        >
                          В блеклист
                        </button>
                      )}
                      {item.restorationMatch ? (
                        <span className="text-xs text-pastel-yellow-text">реставрация</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addToRestoration.mutate({ dealId, itemId: item.id })}
                          disabled={addToRestoration.isPending}
                          className="text-xs text-pastel-yellow-text hover:opacity-80 disabled:opacity-50 text-left"
                        >
                          В реставрацию
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

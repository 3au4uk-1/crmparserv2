import { useUpdateItemSyncOverride, useResetSyncOverrides } from '../api';

const classColors = {
  keyword_match: 'bg-green-50 border-l-4 border-green-400',
  llm_confirmed: 'bg-blue-50 border-l-4 border-blue-400',
  llm_rejected: 'bg-gray-50',
  unclassified: 'bg-gray-50',
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

  if (!items?.length) return <p className="text-sm text-gray-500 p-3">Нет позиций</p>;

  const eligibleCount = items.filter((i) => i.eligibleForTwenty).length;

  function handleCheckboxChange(item, checked) {
    updateOverride.mutate({
      dealId,
      itemId: item.id,
      syncOverride: checked ? 'include' : 'exclude',
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 px-2">
        <span className="text-sm text-gray-600">
          → Twenty: <strong>{eligibleCount}</strong> из <strong>{items.length}</strong>
        </span>
        {!readOnly && (
          <button
            onClick={() => resetOverrides.mutate(dealId)}
            disabled={resetOverrides.isPending}
            className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
          >
            Сбросить к авто
          </button>
        )}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 text-xs uppercase">
            <th className="p-2 w-24">В Twenty</th>
            <th className="p-2">Название</th>
            <th className="p-2">Цена</th>
            <th className="p-2">Кол-во</th>
            <th className="p-2">Классификация</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className={classColors[item.classification] || ''}>
              <td className="p-2" onClick={(e) => e.stopPropagation()}>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(item.eligibleForTwenty)}
                    disabled={readOnly || updateOverride.isPending}
                    onChange={(e) => handleCheckboxChange(item, e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-xs text-gray-500">
                    {item.syncMode === 'manual' ? 'вручную' : 'авто'}
                  </span>
                </label>
              </td>
              <td className="p-2 font-medium">{item.name}</td>
              <td className="p-2">{item.price?.toLocaleString('ru-RU')} ₽</td>
              <td className="p-2">{item.quantity}</td>
              <td className="p-2">
                <span className="text-xs">{classLabels[item.classification] || item.classification}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

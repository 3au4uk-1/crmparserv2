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

export default function DealItems({ items }) {
  if (!items?.length) return <p className="text-sm text-gray-500 p-3">Нет позиций</p>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500 text-xs uppercase">
          <th className="p-2">Название</th>
          <th className="p-2">Цена</th>
          <th className="p-2">Кол-во</th>
          <th className="p-2">Классификация</th>
        </tr>
      </thead>
      <tbody>
        {items.map(item => (
          <tr key={item.id} className={classColors[item.classification] || ''}>
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
  );
}

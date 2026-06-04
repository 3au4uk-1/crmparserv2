import { useState } from 'react';
import { useDeals, useBulkApprove, useBulkReject } from '../api';
import DealRow from '../components/DealRow';

export default function Deals() {
  const [filters, setFilters] = useState({ status: '', company: '' });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const { data, isLoading } = useDeals(filters);
  const bulkApprove = useBulkApprove();
  const bulkReject = useBulkReject();

  const deals = data?.deals || [];

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === deals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(deals.map(d => d.id)));
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Сделки</h2>

      <div className="flex gap-3 mb-4 items-center">
        <select
          value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
        >
          <option value="">Все статусы</option>
          <option value="pending">Ожидают</option>
          <option value="approved">Одобрено</option>
          <option value="synced">Синхронизировано</option>
          <option value="rejected">Отклонено</option>
        </select>
        <select
          value={filters.company}
          onChange={e => setFilters(f => ({ ...f, company: e.target.value }))}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
        >
          <option value="">Все компании</option>
          <option value="ПРО">ПРО</option>
          <option value="АРТ">АРТ</option>
          <option value="АРЕНДА">АРЕНДА</option>
        </select>

        {selectedIds.size > 0 && (
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => { bulkApprove.mutate([...selectedIds]); setSelectedIds(new Set()); }}
              className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-md hover:bg-green-700"
            >
              Одобрить ({selectedIds.size})
            </button>
            <button
              onClick={() => { bulkReject.mutate([...selectedIds]); setSelectedIds(new Set()); }}
              className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-md hover:bg-red-700"
            >
              Отклонить ({selectedIds.size})
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {isLoading ? (
          <p className="p-4 text-sm text-gray-500">Загрузка...</p>
        ) : deals.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">Нет сделок</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="p-3">
                  <input type="checkbox" onChange={toggleAll} checked={selectedIds.size === deals.length && deals.length > 0} className="rounded" />
                </th>
                <th className="p-3">Дата</th>
                <th className="p-3">Название</th>
                <th className="p-3">Компания</th>
                <th className="p-3">Менеджер</th>
                <th className="p-3">Брендинг</th>
                <th className="p-3">Бюджет</th>
                <th className="p-3">Статус</th>
                <th className="p-3">Действия</th>
              </tr>
            </thead>
            <tbody>
              {deals.map(deal => (
                <DealRow
                  key={deal.id}
                  deal={deal}
                  selected={selectedIds.has(deal.id)}
                  onSelect={toggleSelect}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

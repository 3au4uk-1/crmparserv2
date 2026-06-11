import { useState } from 'react';
import {
  useDeals,
  useCompanies,
  useBulkApprove,
  useBulkReject,
  useBulkDeleteDeals,
  useDeleteAllRejected,
} from '../api';
import DealRow from '../components/DealRow';
import DealCard from '../components/DealCard';

const PAGE_SIZE = 50;

function startOfCurrentMonth() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${month}-01`;
}

export default function Deals() {
  const [filters, setFilters] = useState({
    status: '',
    company: '',
    from: startOfCurrentMonth(),
    to: '',
  });
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sort, setSort] = useState({ sortBy: 'start_date', sortDir: 'desc' });

  const { data: companies } = useCompanies();
  const { data, isLoading } = useDeals({
    ...filters,
    ...sort,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const bulkApprove = useBulkApprove();
  const bulkReject = useBulkReject();
  const bulkDelete = useBulkDeleteDeals();
  const deleteAllRejected = useDeleteAllRejected();

  const deals = data?.deals || [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, total);

  const selectedRejected = [...selectedIds].filter((id) => {
    const deal = deals.find((d) => d.id === id);
    return deal?.approval_status === 'rejected';
  });

  function updateFilters(next) {
    setFilters(next);
    setPage(0);
    setSelectedIds(new Set());
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === deals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(deals.map((d) => d.id)));
    }
  }

  function toggleSort(column) {
    setSort((prev) => {
      if (prev.sortBy !== column) return { sortBy: column, sortDir: 'desc' };
      return { sortBy: column, sortDir: prev.sortDir === 'desc' ? 'asc' : 'desc' };
    });
    setPage(0);
    setSelectedIds(new Set());
  }

  function SortableTh({ column, label }) {
    const active = sort.sortBy === column;
    const arrow = active ? (sort.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return (
      <th className="p-3">
        <button
          type="button"
          onClick={() => toggleSort(column)}
          className="uppercase text-xs text-gray-500 hover:text-gray-800 font-normal"
        >
          {label}{arrow}
        </button>
      </th>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Сделки</h2>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <select
          value={filters.status}
          onChange={(e) => updateFilters({ ...filters, status: e.target.value })}
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
          onChange={(e) => updateFilters({ ...filters, company: e.target.value })}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
        >
          <option value="">Все компании</option>
          {(companies || []).map((c) => (
            <option key={c.id} value={c.code}>{c.code}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          С:
          <input
            type="date"
            value={filters.from}
            onChange={(e) => updateFilters({ ...filters, from: e.target.value })}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          По:
          <input
            type="date"
            value={filters.to}
            onChange={(e) => updateFilters({ ...filters, to: e.target.value })}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
          />
        </label>

        {selectedIds.size > 0 && (
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => {
                bulkApprove.mutate([...selectedIds]);
                setSelectedIds(new Set());
              }}
              className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-md hover:bg-green-700"
            >
              Одобрить ({selectedIds.size})
            </button>
            <button
              onClick={() => {
                bulkReject.mutate([...selectedIds]);
                setSelectedIds(new Set());
              }}
              className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-md hover:bg-red-700"
            >
              Отклонить ({selectedIds.size})
            </button>
            {selectedRejected.length > 0 && (
              <button
                onClick={() => {
                  if (!confirm(`Удалить ${selectedRejected.length} отклонённых сделок?`)) return;
                  bulkDelete.mutate(selectedRejected);
                  setSelectedIds(new Set());
                }}
                className="px-3 py-1.5 bg-gray-700 text-white text-sm rounded-md hover:bg-gray-800"
              >
                Удалить ({selectedRejected.length})
              </button>
            )}
          </div>
        )}

        {filters.status === 'rejected' && total > 0 && selectedIds.size === 0 && (
          <button
            onClick={() => {
              if (!confirm(`Удалить все ${total} отклонённых сделок?`)) return;
              deleteAllRejected.mutate();
              setPage(0);
            }}
            className="px-3 py-1.5 bg-gray-700 text-white text-sm rounded-md hover:bg-gray-800 ml-auto"
          >
            Удалить все отклонённые
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <p className="p-4 text-sm text-gray-500">Загрузка...</p>
        </div>
      ) : deals.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <p className="p-4 text-sm text-gray-500">Нет сделок</p>
        </div>
      ) : (
        <>
          <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                  <th className="p-3">
                    <input
                      type="checkbox"
                      onChange={toggleAll}
                      checked={selectedIds.size === deals.length && deals.length > 0}
                      className="rounded"
                    />
                  </th>
                  <SortableTh column="start_date" label="Дата мероприятия" />
                  <SortableTh column="title" label="Название" />
                  <SortableTh column="company_code" label="Компания" />
                  <SortableTh column="manager_name" label="Менеджер" />
                  <th className="p-3" title="Позиций в Twenty / всего">Twenty</th>
                  <SortableTh column="budget" label="Бюджет" />
                  <SortableTh column="approval_status" label="Статус" />
                  <th className="p-3">Действия</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => (
                  <DealRow
                    key={deal.id}
                    deal={deal}
                    selected={selectedIds.has(deal.id)}
                    onSelect={toggleSelect}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden bg-white rounded-lg border border-gray-200 overflow-hidden">
            {deals.map((deal) => (
              <DealCard
                key={deal.id}
                deal={deal}
                selected={selectedIds.has(deal.id)}
                onSelect={toggleSelect}
              />
            ))}
          </div>
        </>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
          <span>
            Показано {pageStart}–{pageEnd} из {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50"
            >
              Назад
            </button>
            <span className="px-2 py-1.5">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50"
            >
              Вперёд
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useDeals,
  useCompanies,
  useBulkApprove,
  useBulkReject,
  useBulkDeleteDeals,
  useDeleteAllRejected,
  usePaymentSync,
  fetchPaymentSyncPreview,
} from '../api';
import { IconRefresh } from '../components/ui/Icons';
import DealRow from '../components/DealRow';
import DealCard from '../components/DealCard';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import { TableSkeleton } from '../components/ui/Skeleton';

const PAGE_SIZE = 50;

const STATUS_CHIPS = [
  { value: '', label: 'Все' },
  { value: 'pending', label: 'Ожидают' },
  { value: 'approved', label: 'Одобрено' },
  { value: 'synced', label: 'Синхронизировано' },
  { value: 'rejected', label: 'Отклонено' },
];

function startOfCurrentMonth() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${month}-01`;
}

export default function Deals() {
  const [searchParams] = useSearchParams();
  const initialStatus = searchParams.get('status') || '';

  const [filters, setFilters] = useState({
    status: initialStatus,
    company: '',
    from: startOfCurrentMonth(),
    to: '',
  });
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sort, setSort] = useState({ sortBy: 'start_date', sortDir: 'desc' });
  const [paymentSyncError, setPaymentSyncError] = useState('');
  const [paymentSyncResult, setPaymentSyncResult] = useState(null);

  useEffect(() => {
    const status = searchParams.get('status') || '';
    setFilters((prev) => ({ ...prev, status }));
    setPage(0);
    setSelectedIds(new Set());
  }, [searchParams]);

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
  const paymentSync = usePaymentSync();

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
      <th>
        <button
          type="button"
          onClick={() => toggleSort(column)}
          className="text-left text-xs font-medium text-ink-muted hover:text-ink transition-colors"
        >
          {label}{arrow}
        </button>
      </th>
    );
  }

  async function onPaymentSync() {
    setPaymentSyncError('');
    setPaymentSyncResult(null);

    if (!filters.from || !filters.to) {
      setPaymentSyncError('Укажите обе даты — с и по');
      return;
    }

    try {
      const preview = await fetchPaymentSyncPreview({
        from: filters.from,
        to: filters.to,
      });
      if (!preview.dealsInRange) {
        setPaymentSyncError('В выбранном диапазоне нет сделок');
        return;
      }

      const confirmed = window.confirm(
        `Синхронизировать поступления для ${preview.dealsInRange} сделок` +
          (preview.dealsInTwenty
            ? ` (${preview.dealsInTwenty} будут обновлены в Twenty)`
            : '') +
          ` за период ${filters.from} — ${filters.to}?`,
      );
      if (!confirmed) return;

      const result = await paymentSync.mutateAsync({
        from: filters.from,
        to: filters.to,
      });
      setPaymentSyncResult(result);
    } catch (err) {
      if (err.response?.status === 409) {
        setPaymentSyncError('Синхронизация поступлений уже выполняется');
        return;
      }
      setPaymentSyncError(
        err.response?.data?.error || err.message || 'Не удалось синхронизировать поступления',
      );
    }
  }

  return (
    <div>
      <PageHeader
        title="Сделки"
        description="Просмотр, фильтрация и массовое одобрение сделок брендинга"
      />

      <div className="surface p-4 mb-4 sticky top-0 z-20 bg-surface/95 backdrop-blur-sm">
        <div className="flex flex-wrap gap-2 mb-4">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => updateFilters({ ...filters, status: chip.value })}
              className={`filter-chip ${
                filters.status === chip.value ? 'filter-chip-active' : 'filter-chip-inactive'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-ink-muted">Компания</span>
            <select
              value={filters.company}
              onChange={(e) => updateFilters({ ...filters, company: e.target.value })}
              className="select-field min-w-[8rem]"
            >
              <option value="">Все</option>
              {(companies || []).map((c) => (
                <option key={c.id} value={c.code}>{c.code}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-ink-muted">С</span>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => updateFilters({ ...filters, from: e.target.value })}
              className="input-field w-auto"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-ink-muted">По</span>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => updateFilters({ ...filters, to: e.target.value })}
              className="input-field w-auto"
            />
          </label>

          <button
            type="button"
            onClick={onPaymentSync}
            disabled={paymentSync.isPending}
            className="btn-secondary btn-sm"
            title="Загрузить поступления из календаря и обновить статус оплаты в Twenty"
          >
            <IconRefresh />
            {paymentSync.isPending ? 'Синхронизация…' : 'Синхр. поступления'}
          </button>

          {filters.status === 'rejected' && total > 0 && selectedIds.size === 0 && (
            <button
              onClick={() => {
                if (!confirm(`Удалить все ${total} отклонённых сделок?`)) return;
                deleteAllRejected.mutate();
                setPage(0);
              }}
              className="btn-danger btn-sm ml-auto"
            >
              Удалить все отклонённые
            </button>
          )}
        </div>

        {(paymentSyncError || paymentSyncResult) && (
          <div className="mt-3 text-sm">
            {paymentSyncError && (
              <p className="text-pastel-red-text">{paymentSyncError}</p>
            )}
            {paymentSyncResult && (
              <p className="text-pastel-green-text">
                Готово: обновлено локально — {paymentSyncResult.dealsUpdatedLocal},
                в Twenty — {paymentSyncResult.dealsUpdatedTwenty}
                {paymentSyncResult.dealsWithPayments > 0
                  ? `, с поступлениями — ${paymentSyncResult.dealsWithPayments}`
                  : ''}
                {paymentSyncResult.dealsFailed > 0
                  ? `, ошибок — ${paymentSyncResult.dealsFailed}`
                  : ''}
              </p>
            )}
          </div>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className="surface-muted px-4 py-3 mb-4 flex flex-wrap items-center gap-3 sticky top-[7.5rem] z-10">
          <span className="text-sm font-medium text-ink">
            Выбрано: <span className="tabular-nums">{selectedIds.size}</span>
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                bulkApprove.mutate([...selectedIds]);
                setSelectedIds(new Set());
              }}
              className="btn-success btn-sm"
            >
              Одобрить
            </button>
            <button
              onClick={() => {
                bulkReject.mutate([...selectedIds]);
                setSelectedIds(new Set());
              }}
              className="btn-danger btn-sm"
            >
              Отклонить
            </button>
            {selectedRejected.length > 0 && (
              <button
                onClick={() => {
                  if (!confirm(`Удалить ${selectedRejected.length} отклонённых сделок?`)) return;
                  bulkDelete.mutate(selectedRejected);
                  setSelectedIds(new Set());
                }}
                className="btn-secondary btn-sm"
              >
                Удалить отклонённые
              </button>
            )}
            <button
              onClick={() => setSelectedIds(new Set())}
              className="btn-ghost btn-sm"
            >
              Снять выбор
            </button>
          </div>
        </div>
      )}

      <div className="surface overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={8} cols={7} />
        ) : deals.length === 0 ? (
          <EmptyState
            title="Сделок не найдено"
            description={
              filters.status
                ? 'Попробуйте изменить фильтры или расширить диапазон дат'
                : 'Запустите парсинг на дашборде, чтобы загрузить сделки из CRM'
            }
          />
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        onChange={toggleAll}
                        checked={selectedIds.size === deals.length && deals.length > 0}
                        className="rounded border-border"
                        aria-label="Выбрать все"
                      />
                    </th>
                    <SortableTh column="start_date" label="Дата" />
                    <SortableTh column="title" label="Название" />
                    <SortableTh column="company_code" label="Компания" />
                    <SortableTh column="manager_name" label="Менеджер" />
                    <th title="Позиций в Twenty / всего">Twenty</th>
                    <SortableTh column="budget" label="Бюджет" />
                    <th>Оплата</th>
                    <SortableTh column="approval_status" label="Статус" />
                    <th>Действия</th>
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
            <div className="md:hidden divide-y divide-border">
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
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm text-ink-muted">
          <span className="tabular-nums">
            {pageStart}–{pageEnd} из {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="btn-secondary btn-sm"
            >
              Назад
            </button>
            <span className="px-2 py-1.5 tabular-nums">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="btn-secondary btn-sm"
            >
              Вперёд
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

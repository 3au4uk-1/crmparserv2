import { useState, useEffect } from 'react';
import {
  useDealStats,
  useRunParsing,
  useParsingStatus,
  useParseRuns,
  useParseDefaults,
} from '../api';
import StatCard from '../components/StatCard';
import PageHeader from '../components/ui/PageHeader';
import { StatSkeleton } from '../components/ui/Skeleton';
import { IconPlay } from '../components/ui/Icons';
import { formatDateTime } from '../utils/dates';
import { Link } from 'react-router-dom';

const statusLabels = {
  completed: { label: 'Завершён', className: 'text-pastel-green-text' },
  running: { label: 'Выполняется', className: 'text-pastel-blue-text' },
  failed: { label: 'Ошибка', className: 'text-pastel-red-text' },
};

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useDealStats();
  const { data: parsingStatus } = useParsingStatus();
  const { data: runs } = useParseRuns();
  const { data: defaults } = useParseDefaults();
  const parsing = useRunParsing();

  const [dateRange, setDateRange] = useState({ from: '', to: '' });

  useEffect(() => {
    if (defaults?.startDate && defaults?.endDate) {
      setDateRange({ from: defaults.startDate, to: defaults.endDate });
    }
  }, [defaults?.startDate, defaults?.endDate]);

  const lastRun = runs?.[0];
  const isParsing = parsing.isPending || parsingStatus?.inProgress;
  const pendingCount = stats?.pending ?? 0;

  function runParsing() {
    parsing.mutate({
      startDate: dateRange.from || undefined,
      endDate: dateRange.to || undefined,
    });
  }

  return (
    <div>
      <PageHeader
        title="Дашборд"
        description="Обзор сделок и управление парсингом из CRM"
      />

      <section className="surface p-5 md:p-6 mb-8" aria-labelledby="parsing-heading">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <h2 id="parsing-heading" className="text-base font-semibold text-ink">
              Запуск парсинга
            </h2>
            <p className="text-sm text-ink-muted mt-1 max-w-lg">
              По умолчанию — с сегодня на 2 недели вперёд. Для ручного запуска можно указать прошлые даты.
            </p>
          </div>
          <button
            onClick={runParsing}
            disabled={isParsing}
            className="btn-primary shrink-0"
          >
            <IconPlay />
            {isParsing ? 'Парсинг...' : 'Запустить парсинг'}
          </button>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-ink-muted font-medium">С</span>
            <input
              type="date"
              value={dateRange.from}
              onChange={(e) => setDateRange((prev) => ({ ...prev, from: e.target.value }))}
              className="input-field w-auto min-w-[10rem]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-ink-muted font-medium">По</span>
            <input
              type="date"
              value={dateRange.to}
              min={dateRange.from || defaults?.startDate || undefined}
              onChange={(e) => setDateRange((prev) => ({ ...prev, to: e.target.value }))}
              className="input-field w-auto min-w-[10rem]"
            />
          </label>
        </div>

        {parsing.isError && (
          <p className="mt-4 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">
            {parsing.error.message}
          </p>
        )}
      </section>

      {statsLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <StatSkeleton key={i} />
          ))}
        </div>
      ) : (
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8" aria-label="Статистика сделок">
          <StatCard label="Всего сделок" value={stats?.total ?? '—'} color="gray" highlight />
          <StatCard label="Ожидают апрува" value={stats?.pending ?? '—'} color="yellow" />
          <StatCard label="Одобрено" value={stats?.approved ?? '—'} color="blue" />
          <StatCard label="Синхронизировано" value={stats?.synced ?? '—'} color="green" />
          <StatCard label="Отклонено" value={stats?.rejected ?? '—'} color="red" />
        </section>
      )}

      {pendingCount > 0 && (
        <div className="surface-muted px-4 py-3 mb-8 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink">
            <span className="font-semibold tabular-nums">{pendingCount}</span>{' '}
            {pendingCount === 1 ? 'сделка ожидает' : 'сделок ожидают'} вашего решения
          </p>
          <Link to="/deals?status=pending" className="btn-secondary btn-sm">
            Перейти к очереди
          </Link>
        </div>
      )}

      {lastRun && (
        <section className="surface p-5 md:p-6" aria-labelledby="last-run-heading">
          <div className="flex items-center justify-between mb-4">
            <h2 id="last-run-heading" className="text-base font-semibold text-ink">
              Последний парсинг
            </h2>
            <Link to="/logs" className="text-xs text-ink-muted hover:text-ink transition-colors">
              Все логи →
            </Link>
          </div>

          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt className="text-ink-muted text-xs mb-0.5">Время</dt>
              <dd className="font-medium tabular-nums">{formatDateTime(lastRun.started_at)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted text-xs mb-0.5">Статус</dt>
              <dd className={`font-medium ${statusLabels[lastRun.status]?.className || 'text-ink'}`}>
                {statusLabels[lastRun.status]?.label || lastRun.status}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted text-xs mb-0.5">Событий</dt>
              <dd className="font-medium tabular-nums">{lastRun.total_events ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-ink-muted text-xs mb-0.5">Новых сделок</dt>
              <dd className="font-medium tabular-nums">{lastRun.new_deals ?? '—'}</dd>
            </div>
          </dl>

          {lastRun.error && (
            <p className="mt-4 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">
              {lastRun.error}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

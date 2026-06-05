import { useState, useEffect } from 'react';
import {
  useDealStats,
  useRunParsing,
  useParsingStatus,
  useParseRuns,
  useParseDefaults,
} from '../api';
import StatCard from '../components/StatCard';

export default function Dashboard() {
  const { data: stats } = useDealStats();
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

  function runParsing() {
    parsing.mutate({
      startDate: dateRange.from || undefined,
      endDate: dateRange.to || undefined,
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Дашборд</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            С:
            <input
              type="date"
              value={dateRange.from}
              min={defaults?.startDate || undefined}
              onChange={(e) => setDateRange((prev) => ({ ...prev, from: e.target.value }))}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            По:
            <input
              type="date"
              value={dateRange.to}
              min={dateRange.from || defaults?.startDate || undefined}
              onChange={(e) => setDateRange((prev) => ({ ...prev, to: e.target.value }))}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            />
          </label>
          <button
            onClick={runParsing}
            disabled={parsing.isPending || parsingStatus?.inProgress}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {parsing.isPending || parsingStatus?.inProgress ? 'Парсинг...' : 'Запустить парсинг'}
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 mb-4">
        Парсятся только сделки с выбранной даты. Даты раньше сегодняшней недоступны.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard label="Всего сделок" value={stats?.total ?? '—'} color="gray" />
        <StatCard label="Ожидают апрува" value={stats?.pending ?? '—'} color="yellow" />
        <StatCard label="Одобрено" value={stats?.approved ?? '—'} color="blue" />
        <StatCard label="Синхронизировано" value={stats?.synced ?? '—'} color="green" />
        <StatCard label="Отклонено" value={stats?.rejected ?? '—'} color="red" />
      </div>

      {lastRun && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Последний парсинг</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Время: </span>
              <span>{new Date(lastRun.started_at).toLocaleString('ru-RU')}</span>
            </div>
            <div>
              <span className="text-gray-500">Статус: </span>
              <span className={lastRun.status === 'completed' ? 'text-green-600' : 'text-red-600'}>
                {lastRun.status}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Событий: </span>
              <span>{lastRun.total_events}</span>
            </div>
            <div>
              <span className="text-gray-500">Новых: </span>
              <span>{lastRun.new_deals}</span>
            </div>
          </div>
          {lastRun.error && (
            <p className="mt-2 text-sm text-red-600">{lastRun.error}</p>
          )}
        </div>
      )}

      {parsing.isError && (
        <p className="mt-4 text-sm text-red-600">Ошибка: {parsing.error.message}</p>
      )}
    </div>
  );
}

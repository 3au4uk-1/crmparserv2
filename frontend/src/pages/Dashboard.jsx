import { useDealStats, useRunParsing, useParsingStatus, useParseRuns } from '../api';
import StatCard from '../components/StatCard';

export default function Dashboard() {
  const { data: stats } = useDealStats();
  const { data: parsingStatus } = useParsingStatus();
  const { data: runs } = useParseRuns();
  const parsing = useRunParsing();

  const lastRun = runs?.[0];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Дашборд</h2>
        <button
          onClick={() => parsing.mutate({})}
          disabled={parsing.isPending || parsingStatus?.inProgress}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {parsing.isPending || parsingStatus?.inProgress ? 'Парсинг...' : 'Запустить парсинг'}
        </button>
      </div>

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

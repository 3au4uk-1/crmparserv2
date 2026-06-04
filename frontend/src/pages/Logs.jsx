import { useLogs } from '../api';

export default function Logs() {
  const { data, isLoading } = useLogs();
  const logs = data?.logs || [];

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Логи парсинга</h2>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {isLoading ? (
          <p className="p-4 text-sm text-gray-500">Загрузка...</p>
        ) : logs.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">Нет логов</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="p-3">Время</th>
                <th className="p-3">Статус</th>
                <th className="p-3">Событий</th>
                <th className="p-3">Новых</th>
                <th className="p-3">Обновлено</th>
                <th className="p-3">Пропущено</th>
                <th className="p-3">Длительность</th>
                <th className="p-3">Ошибка</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const duration = log.finished_at && log.started_at
                  ? Math.round((new Date(log.finished_at) - new Date(log.started_at)) / 1000)
                  : null;

                return (
                  <tr key={log.id} className="border-t border-gray-100">
                    <td className="p-3">{new Date(log.started_at).toLocaleString('ru-RU')}</td>
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        log.status === 'completed' ? 'bg-green-100 text-green-800'
                        : log.status === 'running' ? 'bg-blue-100 text-blue-800'
                        : 'bg-red-100 text-red-800'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="p-3">{log.total_events ?? '—'}</td>
                    <td className="p-3">{log.new_deals ?? '—'}</td>
                    <td className="p-3">{log.updated_deals ?? '—'}</td>
                    <td className="p-3">{log.skipped_deals ?? '—'}</td>
                    <td className="p-3">{duration != null ? `${duration}с` : '—'}</td>
                    <td className="p-3 text-red-600 max-w-xs truncate">{log.error || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

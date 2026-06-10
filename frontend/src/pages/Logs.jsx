import { useState } from 'react';
import { useLogs, useSyncLogs } from '../api';
import { formatDateTime } from '../utils/dates';

function ParseLogsTable({ logs }) {
  return (
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
        {logs.map((log) => {
          const duration = log.finished_at && log.started_at
            ? Math.round((new Date(log.finished_at) - new Date(log.started_at)) / 1000)
            : null;

          return (
            <tr key={log.id} className="border-t border-gray-100">
              <td className="p-3">{formatDateTime(log.started_at)}</td>
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
  );
}

function SyncLogsTable({ logs }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
          <th className="p-3">Время</th>
          <th className="p-3">Сделка</th>
          <th className="p-3">Статус</th>
          <th className="p-3">Действие</th>
          <th className="p-3">Twenty ID</th>
          <th className="p-3">Ошибка</th>
        </tr>
      </thead>
      <tbody>
        {logs.map((log) => (
          <tr key={log.id} className="border-t border-gray-100">
            <td className="p-3">{formatDateTime(log.created_at)}</td>
            <td className="p-3 max-w-xs truncate">{log.deal_title || `Deal #${log.deal_id}`}</td>
            <td className="p-3">
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                log.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {log.status}
              </span>
            </td>
            <td className="p-3 text-xs text-gray-600">
              {log.action === 'created' ? 'создание'
                : log.action === 'updated' ? 'обновление'
                : log.action === 'updated_empty' ? 'обнуление'
                : '—'}
            </td>
            <td className="p-3 font-mono text-xs">{log.twenty_id || '—'}</td>
            <td className="p-3 text-red-600 max-w-xs truncate">{log.error || ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Logs() {
  const [tab, setTab] = useState('parse');
  const { data: parseData, isLoading: parseLoading } = useLogs();
  const { data: syncData, isLoading: syncLoading } = useSyncLogs();

  const isLoading = tab === 'parse' ? parseLoading : syncLoading;
  const logs = tab === 'parse' ? (parseData?.logs || []) : (syncData?.logs || []);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-800">Логи</h2>
        <div className="flex gap-1 bg-gray-100 rounded-md p-1">
          <button
            onClick={() => setTab('parse')}
            className={`px-3 py-1.5 text-sm rounded ${tab === 'parse' ? 'bg-white shadow-sm' : 'text-gray-600'}`}
          >
            Парсинг
          </button>
          <button
            onClick={() => setTab('sync')}
            className={`px-3 py-1.5 text-sm rounded ${tab === 'sync' ? 'bg-white shadow-sm' : 'text-gray-600'}`}
          >
            Синхронизация
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {isLoading ? (
          <p className="p-4 text-sm text-gray-500">Загрузка...</p>
        ) : logs.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">Нет логов</p>
        ) : tab === 'parse' ? (
          <ParseLogsTable logs={logs} />
        ) : (
          <SyncLogsTable logs={logs} />
        )}
      </div>
    </div>
  );
}

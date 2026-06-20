import { useState } from 'react';
import { useLogs, useSyncLogs } from '../api';
import { formatDateTime } from '../utils/dates';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import { TableSkeleton } from '../components/ui/Skeleton';

const parseStatusConfig = {
  completed: { label: 'Завершён', className: 'bg-pastel-green-bg text-pastel-green-text' },
  running: { label: 'Выполняется', className: 'bg-pastel-blue-bg text-pastel-blue-text' },
  failed: { label: 'Ошибка', className: 'bg-pastel-red-bg text-pastel-red-text' },
};

const syncStatusConfig = {
  success: { label: 'Успех', className: 'bg-pastel-green-bg text-pastel-green-text' },
  error: { label: 'Ошибка', className: 'bg-pastel-red-bg text-pastel-red-text' },
};

function StatusPill({ config, status }) {
  const cfg = config[status] || { label: status, className: 'bg-pastel-gray-bg text-pastel-gray-text' };
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wide ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function ParseLogsTable({ logs }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr className="bg-surface-muted">
            <th>Время</th>
            <th>Статус</th>
            <th>Событий</th>
            <th>Новых</th>
            <th>Обновлено</th>
            <th>Пропущено</th>
            <th>Длительность</th>
            <th>Ошибка</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => {
            const duration = log.finished_at && log.started_at
              ? Math.round((new Date(log.finished_at) - new Date(log.started_at)) / 1000)
              : null;

            return (
              <tr key={log.id}>
                <td className="tabular-nums whitespace-nowrap">{formatDateTime(log.started_at)}</td>
                <td><StatusPill config={parseStatusConfig} status={log.status} /></td>
                <td className="tabular-nums">{log.total_events ?? '—'}</td>
                <td className="tabular-nums">{log.new_deals ?? '—'}</td>
                <td className="tabular-nums">{log.updated_deals ?? '—'}</td>
                <td className="tabular-nums">{log.skipped_deals ?? '—'}</td>
                <td className="tabular-nums">{duration != null ? `${duration}с` : '—'}</td>
                <td className="text-pastel-red-text max-w-xs truncate text-xs">{log.error || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SyncLogsTable({ logs }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr className="bg-surface-muted">
            <th>Время</th>
            <th>Сделка</th>
            <th>Статус</th>
            <th>Действие</th>
            <th>Twenty ID</th>
            <th>Ошибка</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td className="tabular-nums whitespace-nowrap">{formatDateTime(log.created_at)}</td>
              <td className="max-w-xs truncate font-medium">{log.deal_title || `Deal #${log.deal_id}`}</td>
              <td><StatusPill config={syncStatusConfig} status={log.status} /></td>
              <td className="text-xs text-ink-muted">
                {log.action === 'created' ? 'создание'
                  : log.action === 'updated' ? 'обновление'
                  : log.action === 'updated_empty' ? 'обнуление'
                  : '—'}
              </td>
              <td className="font-mono text-xs">{log.twenty_id || '—'}</td>
              <td className="text-pastel-red-text max-w-xs truncate text-xs">{log.error || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      <PageHeader
        title="Логи"
        description="История парсинга и синхронизации с Twenty CRM"
        actions={
          <div className="flex gap-1 bg-surface-muted border border-border rounded-lg p-1">
            <button
              onClick={() => setTab('parse')}
              className={`px-3 py-1.5 text-sm rounded-md transition-all duration-200 ${
                tab === 'parse'
                  ? 'bg-surface text-ink shadow-subtle font-medium'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Парсинг
            </button>
            <button
              onClick={() => setTab('sync')}
              className={`px-3 py-1.5 text-sm rounded-md transition-all duration-200 ${
                tab === 'sync'
                  ? 'bg-surface text-ink shadow-subtle font-medium'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Синхронизация
            </button>
          </div>
        }
      />

      <div className="surface overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : logs.length === 0 ? (
          <EmptyState
            title="Записей пока нет"
            description={
              tab === 'parse'
                ? 'Логи появятся после первого запуска парсинга'
                : 'Логи появятся после синхронизации сделок с Twenty'
            }
          />
        ) : tab === 'parse' ? (
          <ParseLogsTable logs={logs} />
        ) : (
          <SyncLogsTable logs={logs} />
        )}
      </div>
    </div>
  );
}

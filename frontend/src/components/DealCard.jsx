import { useState } from 'react';
import { useDeal, useApproveDeal, useRejectDeal, useDeleteDeal, useResyncDeal } from '../api';
import { formatEventDate, formatDateTime } from '../utils/dates';
import StatusBadge from './StatusBadge';
import DealItems from './DealItems';

export default function DealCard({ deal, selected, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  const { data: details } = useDeal(expanded ? deal.id : null);
  const approve = useApproveDeal();
  const reject = useRejectDeal();
  const deleteDeal = useDeleteDeal();
  const resync = useResyncDeal();

  return (
    <div className="border-b border-gray-100 p-3">
      <div
        className="flex gap-2 items-start cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(deal.id)}
          onClick={(e) => e.stopPropagation()}
          className="rounded mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between gap-2">
            <span className="text-sm text-gray-600">
              {formatEventDate(deal.start_date, deal.arrival_time)}
            </span>
            <StatusBadge status={deal.approval_status} />
          </div>
          <p className="text-sm font-medium truncate">{deal.title}</p>
          <p className="text-xs text-gray-500">
            {deal.company_code} · {deal.manager_name}
          </p>
        </div>
      </div>

      {deal.twenty_error && (
        <p className="text-xs text-red-600 mt-1 truncate" title={deal.twenty_error}>
          {deal.twenty_error}
        </p>
      )}

      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        {deal.approval_status === 'pending' && (
          <div className="flex gap-1">
            <button
              onClick={() => approve.mutate(deal.id)}
              disabled={approve.isPending}
              className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
            >
              ✓
            </button>
            <button
              onClick={() => reject.mutate(deal.id)}
              disabled={reject.isPending}
              className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50"
            >
              ✗
            </button>
          </div>
        )}
        {deal.approval_status === 'synced' && (
          <div className="flex flex-col gap-1">
            {deal.synced_at && (
              <span className="text-xs text-gray-500" title={deal.synced_at}>
                Синхр. {formatDateTime(deal.synced_at)}
              </span>
            )}
            <button
              onClick={() => resync.mutate(deal.id)}
              disabled={resync.isPending}
              className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50 w-fit"
            >
              Пересинхр.
            </button>
          </div>
        )}
        {deal.approval_status === 'rejected' && (
          <button
            onClick={() => {
              if (!confirm('Удалить эту сделку?')) return;
              deleteDeal.mutate(deal.id);
            }}
            disabled={deleteDeal.isPending}
            className="px-2 py-1 bg-gray-700 text-white text-xs rounded hover:bg-gray-800 disabled:opacity-50"
          >
            Удалить
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="grid grid-cols-2 gap-3 text-sm mb-3">
            <div><span className="text-gray-500">Контакт:</span> {details?.contact_name}</div>
            <div><span className="text-gray-500">Email:</span> {details?.contact_email}</div>
            <div><span className="text-gray-500">Компания:</span> {details?.contact_company}</div>
            <div><span className="text-gray-500">Адрес:</span> {details?.address}</div>
          </div>
          <DealItems
            dealId={deal.id}
            items={details?.items}
            readOnly={deal.approval_status === 'synced'}
          />
        </div>
      )}
    </div>
  );
}

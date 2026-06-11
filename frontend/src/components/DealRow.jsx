import { useState } from 'react';
import { useDeal, useApproveDeal, useRejectDeal, useDeleteDeal, useResyncDeal } from '../api';
import { formatEventDate, formatDateTime } from '../utils/dates';
import StatusBadge from './StatusBadge';
import DealItems from './DealItems';

export default function DealRow({ deal, selected, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  const { data: details } = useDeal(expanded ? deal.id : null);
  const approve = useApproveDeal();
  const reject = useRejectDeal();
  const deleteDeal = useDeleteDeal();
  const resync = useResyncDeal();

  return (
    <>
      <tr
        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="p-3" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(deal.id)}
            className="rounded"
          />
        </td>
        <td className="p-3 text-sm">{formatEventDate(deal.start_date, deal.arrival_time)}</td>
        <td className="p-3 text-sm font-medium max-w-xs truncate">{deal.title}</td>
        <td className="p-3 text-sm">{deal.company_code}</td>
        <td className="p-3 text-sm">{deal.manager_name}</td>
        <td className="p-3 text-sm" title="Позиций в Twenty / всего">
          {deal.branding_count}/{deal.total_items}
        </td>
        <td className="p-3 text-sm">{deal.budget}</td>
        <td className="p-3">
          <StatusBadge status={deal.approval_status} />
          {deal.twenty_error && (
            <p className="text-xs text-red-600 mt-1 max-w-[10rem] truncate" title={deal.twenty_error}>
              {deal.twenty_error}
            </p>
          )}
        </td>
        <td className="p-3" onClick={e => e.stopPropagation()}>
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
                className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
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
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} className="bg-gray-50 p-0">
            <div className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
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
          </td>
        </tr>
      )}
    </>
  );
}

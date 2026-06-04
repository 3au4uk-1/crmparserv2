import { useState } from 'react';
import { useDeal, useApproveDeal, useRejectDeal } from '../api';
import StatusBadge from './StatusBadge';
import DealItems from './DealItems';

export default function DealRow({ deal, selected, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  const { data: details } = useDeal(expanded ? deal.id : null);
  const approve = useApproveDeal();
  const reject = useRejectDeal();

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
        <td className="p-3 text-sm">{deal.start_date?.slice(0, 10)}</td>
        <td className="p-3 text-sm font-medium max-w-xs truncate">{deal.title}</td>
        <td className="p-3 text-sm">{deal.company_code}</td>
        <td className="p-3 text-sm">{deal.manager_name}</td>
        <td className="p-3 text-sm">{deal.branding_count}/{deal.total_items}</td>
        <td className="p-3 text-sm">{deal.budget}</td>
        <td className="p-3"><StatusBadge status={deal.approval_status} /></td>
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
              <DealItems items={details?.items} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

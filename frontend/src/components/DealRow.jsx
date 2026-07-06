import { useState } from 'react';
import { useDeal, useApproveDeal, useRejectDeal, useDeleteDeal, useResyncDeal } from '../api';
import { formatEventDate, formatDateTime } from '../utils/dates';
import StatusBadge from './StatusBadge';
import PaymentBadge from './PaymentBadge';
import DealItems from './DealItems';
import TonyBookingField from './TonyBookingField';
import { IconCheck, IconX, IconRefresh } from './ui/Icons';

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
        className="cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <td onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(deal.id)}
            className="rounded border-border"
            aria-label={`Выбрать ${deal.title}`}
          />
        </td>
        <td className="text-sm tabular-nums whitespace-nowrap">
          {formatEventDate(deal.start_date, deal.arrival_time)}
        </td>
        <td className="text-sm font-medium max-w-xs truncate">{deal.title}</td>
        <td className="text-sm font-mono text-xs">{deal.company_code}</td>
        <td className="text-sm">{deal.manager_name}</td>
        <td className="text-sm tabular-nums" title="Позиций в Twenty / всего">
          {deal.branding_count}/{deal.total_items}
        </td>
        <td className="text-sm tabular-nums">{deal.budget}</td>
        <td>
          <PaymentBadge status={deal.payment_status} amount={deal.payment_amount} />
        </td>
        <td>
          <StatusBadge status={deal.approval_status} />
          {deal.twenty_error && (
            <p className="text-xs text-pastel-red-text mt-1 max-w-[10rem] truncate" title={deal.twenty_error}>
              {deal.twenty_error}
            </p>
          )}
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          {deal.approval_status === 'pending' && (
            <div className="flex gap-1">
              <button
                onClick={() => approve.mutate(deal.id)}
                disabled={approve.isPending}
                className="btn-success btn-sm"
                title="Одобрить"
                aria-label="Одобрить"
              >
                <IconCheck />
              </button>
              <button
                onClick={() => reject.mutate(deal.id)}
                disabled={reject.isPending}
                className="btn-danger btn-sm"
                title="Отклонить"
                aria-label="Отклонить"
              >
                <IconX />
              </button>
            </div>
          )}
          {deal.approval_status === 'synced' && (
            <div className="flex flex-col gap-1">
              {deal.synced_at && (
                <span className="text-xs text-ink-faint tabular-nums" title={deal.synced_at}>
                  {formatDateTime(deal.synced_at)}
                </span>
              )}
              <button
                onClick={() => resync.mutate(deal.id)}
                disabled={resync.isPending}
                className="btn-secondary btn-sm"
              >
                <IconRefresh />
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
              className="btn-secondary btn-sm"
            >
              Удалить
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="bg-surface-muted p-0">
            <div className="p-5 border-t border-border">
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
                <div><dt className="text-ink-muted text-xs mb-0.5">Контакт</dt><dd>{details?.contact_name || '—'}</dd></div>
                <div><dt className="text-ink-muted text-xs mb-0.5">Email</dt><dd>{details?.contact_email || '—'}</dd></div>
                <div><dt className="text-ink-muted text-xs mb-0.5">Компания</dt><dd>{details?.contact_company || '—'}</dd></div>
                <div><dt className="text-ink-muted text-xs mb-0.5">Адрес</dt><dd>{details?.address || '—'}</dd></div>
              </dl>
              <TonyBookingField dealId={deal.id} currentBookingId={details?.tony_order_id} />
              <DealItems dealId={deal.id} items={details?.items} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

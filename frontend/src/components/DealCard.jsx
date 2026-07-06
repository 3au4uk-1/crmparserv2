import { useState } from 'react';
import { useDeal, useApproveDeal, useRejectDeal, useDeleteDeal, useResyncDeal } from '../api';
import { formatEventDate, formatDateTime } from '../utils/dates';
import StatusBadge from './StatusBadge';
import PaymentBadge from './PaymentBadge';
import DealItems from './DealItems';
import TonyBookingField from './TonyBookingField';
import { IconCheck, IconX, IconRefresh } from './ui/Icons';

export default function DealCard({ deal, selected, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  const { data: details } = useDeal(expanded ? deal.id : null);
  const approve = useApproveDeal();
  const reject = useRejectDeal();
  const deleteDeal = useDeleteDeal();
  const resync = useResyncDeal();

  return (
    <div className="p-4">
      <div
        className="flex gap-3 items-start cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(deal.id)}
          onClick={(e) => e.stopPropagation()}
          className="rounded border-border mt-1"
          aria-label={`Выбрать ${deal.title}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between gap-2 mb-1">
            <span className="text-xs text-ink-muted tabular-nums">
              {formatEventDate(deal.start_date, deal.arrival_time)}
            </span>
            <StatusBadge status={deal.approval_status} />
          </div>
          <p className="text-sm font-medium leading-snug">{deal.title}</p>
          <p className="text-xs text-ink-faint mt-0.5 font-mono">
            {deal.company_code} · {deal.manager_name}
          </p>
          <div className="mt-1">
            <PaymentBadge status={deal.payment_status} amount={deal.payment_amount} />
          </div>
        </div>
      </div>

      {deal.twenty_error && (
        <p className="text-xs text-pastel-red-text mt-2 truncate" title={deal.twenty_error}>
          {deal.twenty_error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
        {deal.approval_status === 'pending' && (
          <>
            <button
              onClick={() => approve.mutate(deal.id)}
              disabled={approve.isPending}
              className="btn-success btn-sm"
            >
              <IconCheck /> Одобрить
            </button>
            <button
              onClick={() => reject.mutate(deal.id)}
              disabled={reject.isPending}
              className="btn-danger btn-sm"
            >
              <IconX /> Отклонить
            </button>
          </>
        )}
        {deal.approval_status === 'synced' && (
          <>
            {deal.synced_at && (
              <span className="text-xs text-ink-faint self-center tabular-nums">
                {formatDateTime(deal.synced_at)}
              </span>
            )}
            <button
              onClick={() => resync.mutate(deal.id)}
              disabled={resync.isPending}
              className="btn-secondary btn-sm"
            >
              <IconRefresh /> Пересинхр.
            </button>
          </>
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
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-border">
          <dl className="grid grid-cols-2 gap-3 text-sm mb-4">
            <div><dt className="text-ink-muted text-xs mb-0.5">Контакт</dt><dd>{details?.contact_name || '—'}</dd></div>
            <div><dt className="text-ink-muted text-xs mb-0.5">Email</dt><dd>{details?.contact_email || '—'}</dd></div>
            <div><dt className="text-ink-muted text-xs mb-0.5">Компания</dt><dd>{details?.contact_company || '—'}</dd></div>
            <div><dt className="text-ink-muted text-xs mb-0.5">Адрес</dt><dd>{details?.address || '—'}</dd></div>
          </dl>
          <TonyBookingField dealId={deal.id} currentBookingId={details?.tony_order_id} />
          <DealItems dealId={deal.id} items={details?.items} />
        </div>
      )}
    </div>
  );
}

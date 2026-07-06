const labels = {
  NE_OPLACHENO: 'Не оплачено',
  PREDOPLATA: 'Предоплата',
  OPLACHENO_POLNOSTYU: 'Оплачено полностью',
  VOZVRAT: 'Возврат',
};

const classes = {
  NE_OPLACHENO: 'text-ink-faint',
  PREDOPLATA: 'text-pastel-yellow-text',
  OPLACHENO_POLNOSTYU: 'text-pastel-green-text',
  VOZVRAT: 'text-pastel-red-text',
};

export function formatPaymentAmount(amount) {
  if (amount == null || amount <= 0) return '—';
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount) + ' ₽';
}

export function paymentStatusLabel(status) {
  return labels[status] || '—';
}

export function paymentStatusClass(status) {
  return classes[status] || 'text-ink-faint';
}

export default function PaymentBadge({ status, amount }) {
  if (!status || status === 'NE_OPLACHENO') {
    return <span className="text-xs text-ink-faint">Не оплачено</span>;
  }

  return (
    <div className="leading-tight">
      <div className={`text-xs font-medium ${paymentStatusClass(status)}`}>
        {paymentStatusLabel(status)}
      </div>
      <div className="text-xs tabular-nums text-ink-muted">{formatPaymentAmount(amount)}</div>
    </div>
  );
}

const statusConfig = {
  pending: { label: 'Ожидает', className: 'bg-pastel-yellow-bg text-pastel-yellow-text' },
  approved: { label: 'Одобрено', className: 'bg-pastel-blue-bg text-pastel-blue-text' },
  synced: { label: 'Синхр.', className: 'bg-pastel-green-bg text-pastel-green-text' },
  rejected: { label: 'Отклонено', className: 'bg-pastel-red-bg text-pastel-red-text' },
};

export default function StatusBadge({ status }) {
  const cfg = statusConfig[status] || { label: status, className: 'bg-pastel-gray-bg text-pastel-gray-text' };
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wide ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

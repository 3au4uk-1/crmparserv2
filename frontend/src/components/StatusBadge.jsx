const statusConfig = {
  pending: { label: 'Ожидает', className: 'bg-yellow-100 text-yellow-800' },
  approved: { label: 'Одобрено', className: 'bg-blue-100 text-blue-800' },
  synced: { label: 'Синхр.', className: 'bg-green-100 text-green-800' },
  rejected: { label: 'Отклонено', className: 'bg-red-100 text-red-800' },
};

export default function StatusBadge({ status }) {
  const cfg = statusConfig[status] || { label: status, className: 'bg-gray-100 text-gray-800' };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

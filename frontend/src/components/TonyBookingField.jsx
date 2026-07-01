import { useState } from 'react';
import { useAttachTonyBooking } from '../api';

export default function TonyBookingField({ dealId, currentBookingId }) {
  const [value, setValue] = useState(currentBookingId || '');
  const attach = useAttachTonyBooking();

  function handleSubmit(e) {
    e.preventDefault();
    const bookingNumber = value.trim();
    if (!/^\d+$/.test(bookingNumber)) return;
    attach.mutate({ dealId, bookingNumber });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 mb-4" onClick={(e) => e.stopPropagation()}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-muted text-xs font-medium">ID брони Tony</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          placeholder="169120"
          className="input-field w-32"
          disabled={attach.isPending}
        />
      </label>
      <button type="submit" disabled={attach.isPending || !/^\d+$/.test(value.trim())} className="btn-secondary btn-sm">
        {attach.isPending ? 'Загрузка...' : 'Привязать'}
      </button>
      {attach.isError && (
        <p className="text-xs text-pastel-red-text w-full">{attach.error?.response?.data?.error || attach.error?.message}</p>
      )}
    </form>
  );
}

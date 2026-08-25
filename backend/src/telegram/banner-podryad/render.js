function formatDateLabel(loadDateYmd) {
  const [, month, day] = String(loadDateYmd).split('-');
  return `${day}.${month}`;
}

function bookingLabel(booking) {
  return booking ? booking : '—';
}

export function renderBannerPodryadMessage({ mode, loadDateYmd, items }) {
  if (!items?.length) return '';

  const title =
    mode === 'catchup'
      ? `Догон · отгрузка ${formatDateLabel(loadDateYmd)}`
      : `Накануне отгрузки ${formatDateLabel(loadDateYmd)}`;

  const groups = [];
  const indexByKey = new Map();
  for (const item of items) {
    const key = bookingLabel(item.booking);
    let group = indexByKey.get(key);
    if (!group) {
      group = { booking: key, names: [] };
      indexByKey.set(key, group);
      groups.push(group);
    }
    group.names.push(item.name);
  }

  const blocks = groups.map((group) => {
    const lines = [`Бронь: ${group.booking}`];
    for (const name of group.names) {
      lines.push(`• ${name}`);
      lines.push('  Фото в чат');
    }
    return lines.join('\n');
  });

  return `${title}\n\n${blocks.join('\n\n')}`;
}

import { describe, expect, it } from 'vitest';
import { extractBookingId } from '../src/telegram/banner-podryad/booking.js';
import { isBannerPodryadReminderItem } from '../src/telegram/banner-podryad/item.js';
import { renderBannerPodryadMessage } from '../src/telegram/banner-podryad/render.js';

describe('extractBookingId', () => {
  it('takes first 5–6 digit booking from deal name', () => {
    expect(
      extractBookingId('АРЕНДА/28-30.07/рулетка Алина тг/180288/Полякова'),
    ).toBe('180288');
    expect(extractBookingId('АРЕНДА/26.07/Екатерина/Ретро-игры/179512Фест./Фидж.')).toBe(
      '179512',
    );
  });

  it('returns empty when missing', () => {
    expect(extractBookingId('АРЕНДА/28-30.07/без брони')).toBe('');
    expect(extractBookingId(undefined)).toBe('');
  });
});

describe('isBannerPodryadReminderItem', () => {
  it('includes BANNERA and PODRYAD except OTMENA', () => {
    expect(isBannerPodryadReminderItem({ tip: 'BANNERA', stage: 'V_RABOTE' })).toBe(true);
    expect(isBannerPodryadReminderItem({ tip: 'PODRYAD', stage: 'GOTOVO' })).toBe(true);
    expect(isBannerPodryadReminderItem({ tip: 'BANNERA', stage: 'OTMENA' })).toBe(false);
    expect(isBannerPodryadReminderItem({ tip: 'OKLEYKA', stage: 'V_RABOTE' })).toBe(false);
  });
});

describe('renderBannerPodryadMessage', () => {
  it('renders evening copy grouped by booking', () => {
    expect(
      renderBannerPodryadMessage({
        mode: 'evening',
        loadDateYmd: '2026-08-25',
        items: [{ booking: '180288', name: 'Баннер 3x6' }],
      }),
    ).toBe(
      ['Накануне отгрузки 25.08', '', 'Бронь: 180288', '• Баннер 3x6', '  Фото в чат'].join(
        '\n',
      ),
    );
  });

  it('uses catch-up title and dash for empty booking', () => {
    expect(
      renderBannerPodryadMessage({
        mode: 'catchup',
        loadDateYmd: '2026-08-25',
        items: [{ booking: '', name: 'Подряд' }],
      }),
    ).toBe(
      ['Догон · отгрузка 25.08', '', 'Бронь: —', '• Подряд', '  Фото в чат'].join('\n'),
    );
  });

  it('groups items that share a booking', () => {
    const text = renderBannerPodryadMessage({
      mode: 'evening',
      loadDateYmd: '2026-08-25',
      items: [
        { booking: '180288', name: 'Баннер 3x6' },
        { booking: '180288', name: 'Баннер 2x4' },
        { booking: '11111', name: 'Подряд А' },
      ],
    });
    expect(text).toBe(
      [
        'Накануне отгрузки 25.08',
        '',
        'Бронь: 180288',
        '• Баннер 3x6',
        '  Фото в чат',
        '• Баннер 2x4',
        '  Фото в чат',
        '',
        'Бронь: 11111',
        '• Подряд А',
        '  Фото в чат',
      ].join('\n'),
    );
  });

  it('returns empty string for empty item lists', () => {
    expect(
      renderBannerPodryadMessage({
        mode: 'evening',
        loadDateYmd: '2026-08-25',
        items: [],
      }),
    ).toBe('');
  });
});

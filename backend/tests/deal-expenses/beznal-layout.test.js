import { describe, it, expect } from 'vitest';
import { parseBeznalSheet } from '../../src/services/deal-expenses/readers/beznalLayout.js';

describe('parseBeznalSheet', () => {
  it('pairs payment row with deal row and extracts deal_id and amount', () => {
    const data = [
      ['Название', 'Статус', 'Сумма к оплате', 'Дата начала мероприятия', 'Сделка в Б24'],
      ['Заявка на оплату', '', '12 500', '01.03.25', ''],
      ['', '', '', '', 'Проект /01.03.25 https://apihide.com/crm/deal/details/169120/'],
    ];

    const meta = {
      source: 'beznal',
      year: 2025,
      spreadsheet: 'beznal.xlsx',
      tab: 'Март 2025',
      sheet: null,
    };

    const records = parseBeznalSheet(data, meta);

    expect(records).toHaveLength(1);
    expect(records[0].deal_id).toBe('169120');
    expect(records[0].amount).toBe(12500);
    expect(records[0].source).toBe('beznal');
    expect(records[0].deal_name).toContain('Проект');
  });

  it('returns empty array when header row is missing', () => {
    const data = [['foo', 'bar']];
    const records = parseBeznalSheet(data, { source: 'beznal', year: 2025, tab: '', spreadsheet: '' });
    expect(records).toEqual([]);
  });
});

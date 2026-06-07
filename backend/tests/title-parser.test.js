import { describe, it, expect } from 'vitest';
import { parseDealTitle, extractTonyOrderId } from '../src/services/title-parser.js';

describe('parseDealTitle', () => {
  it('extracts company and manager from standard format', () => {
    const result = parseDealTitle(
      'ПРО/29.05-05.06./КАПЫ/ЛУЖНИКИ/В МОМЕНТЕ/167015 /ДОЗАБОР+ПРОДЛЕНИЕ/168973/Шунькин'
    );
    expect(result.companyCode).toBe('ПРО');
    expect(result.managerName).toBe('Шунькин');
  });

  it('handles АРТ company', () => {
    const result = parseDealTitle('АРТ/10.06/ВЫСТАВКА/Иванов');
    expect(result.companyCode).toBe('АРТ');
    expect(result.managerName).toBe('Иванов');
  });

  it('handles АРЕНДА company', () => {
    const result = parseDealTitle('АРЕНДА/15.06-20.06/ПАРК/Петрова');
    expect(result.companyCode).toBe('АРЕНДА');
    expect(result.managerName).toBe('Петрова');
  });

  it('handles title with only two segments', () => {
    const result = parseDealTitle('ПРО/Сидоров');
    expect(result.companyCode).toBe('ПРО');
    expect(result.managerName).toBe('Сидоров');
  });

  it('handles title with no slashes', () => {
    const result = parseDealTitle('Неформатированная сделка');
    expect(result.companyCode).toBe(null);
    expect(result.managerName).toBe(null);
    expect(result.parseError).toBe(true);
  });

  it('trims whitespace from segments', () => {
    const result = parseDealTitle(' ПРО / 29.05 / Шунькин ');
    expect(result.companyCode).toBe('ПРО');
    expect(result.managerName).toBe('Шунькин');
  });

  it('includes tonyOrderId in parsed result', () => {
    const result = parseDealTitle('ПРО/ЯУЗА DFF // Артем // 6 июня // 167910 // ПОСТОПЛАТА/Титова');
    expect(result.tonyOrderId).toBe('167910');
  });

  it('returns null tonyOrderId when no number in title', () => {
    const result = parseDealTitle('ПРО/Сидоров');
    expect(result.tonyOrderId).toBe(null);
  });
});

describe('extractTonyOrderId', () => {
  it('extracts ID from standard double-slash format', () => {
    expect(extractTonyOrderId(
      'ПРО/ЯУЗА DFF // Артем // 6 июня // 167910 // ПОСТОПЛАТА/Титова'
    )).toBe('167910');
  });

  it('extracts ID from slash-separated format', () => {
    expect(extractTonyOrderId(
      'АРТ/06.05/Владислава мебель/167099/Клепикова'
    )).toBe('167099');
  });

  it('extracts last ID when embedded in segment text', () => {
    expect(extractTonyOrderId(
      'БС/35610 РБ Ева ротанг 6.06. 169283/Радченкова'
    )).toBe('169283');
  });

  it('returns last ID when multiple are present', () => {
    expect(extractTonyOrderId(
      'ПРО/29.05-05.06./КАПЫ/ЛУЖНИКИ/В МОМЕНТЕ/167015 /ДОЗАБОР+ПРОДЛЕНИЕ/168973/Шунькин'
    )).toBe('168973');
  });

  it('returns null when no 5+ digit number found', () => {
    expect(extractTonyOrderId('ПРО/Сидоров')).toBe(null);
  });

  it('returns null for empty/null input', () => {
    expect(extractTonyOrderId(null)).toBe(null);
    expect(extractTonyOrderId('')).toBe(null);
  });

  it('ignores short numbers like dates', () => {
    expect(extractTonyOrderId('АРТ/06.05/Иванов')).toBe(null);
  });
});

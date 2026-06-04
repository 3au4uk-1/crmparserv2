import { describe, it, expect } from 'vitest';
import { parseDealTitle } from '../src/services/title-parser.js';

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
});

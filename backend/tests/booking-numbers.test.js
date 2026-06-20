import { describe, it, expect } from 'vitest';
import { extractBookingNumbers } from '../src/services/booking-numbers.js';

describe('extractBookingNumbers', () => {
  it('returns empty array for missing/empty title', () => {
    expect(extractBookingNumbers(null)).toEqual([]);
    expect(extractBookingNumbers('')).toEqual([]);
  });

  it('returns empty array when no 5-7 digit number present', () => {
    expect(extractBookingNumbers('ПРО/06.05/Иванов')).toEqual([]);
  });

  it('extracts a single booking number', () => {
    expect(extractBookingNumbers('АРТ/06.05/Владислава мебель/167099/Клепикова')).toEqual(['167099']);
  });

  it('extracts multiple booking numbers in order', () => {
    expect(
      extractBookingNumbers('ПРО/КАПЫ/167015 /ДОЗАБОР/168973/Шунькин')
    ).toEqual(['167015', '168973']);
  });

  it('deduplicates repeated numbers preserving first occurrence', () => {
    expect(extractBookingNumbers('ПРО/167015/повтор 167015/Шунькин')).toEqual(['167015']);
  });

  it('ignores 8+ digit numbers (phones) and 1-4 digit numbers (dates)', () => {
    expect(extractBookingNumbers('ПРО/06.05/тел 89261234567/Иванов')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  isBlankFormValue,
  parseFormFields,
  parseWorkRequestForm,
} from '../src/telegram/work-requests/parse-form.js';

describe('isBlankFormValue', () => {
  it.each(['', '  ', '-', 'нет', 'НЕТ', 'файл', 'Файл'])('treats %j as blank', (v) => {
    expect(isBlankFormValue(v)).toBe(true);
  });
  it('keeps a real value', () => {
    expect(isBlankFormValue('брединг 1')).toBe(false);
  });
});

describe('parseFormFields', () => {
  it('reads Key: value lines', () => {
    const fields = parseFormFields('@bot\nБронь: 123456\nТЗ: сделать макет');
    expect(fields['бронь']).toBe('123456');
    expect(fields['тз']).toBe('сделать макет');
  });

  it('keeps body lines after an empty ТЗ field', () => {
    const fields = parseFormFields([
      '@bot',
      'ТЗ:',
      'цвет: красный',
      'логотип разместить по центру',
    ].join('\n'));

    expect(fields['тз']).toBe('цвет: красный\nлоготип разместить по центру');
  });

  it('keeps continuations until the next known field', () => {
    const fields = parseFormFields([
      '@bot',
      'ТЗ: первая строка',
      'вторая строка',
      'Бронь: 123456',
    ].join('\n'));

    expect(fields['тз']).toBe('первая строка\nвторая строка');
    expect(fields['бронь']).toBe('123456');
  });
});

describe('parseWorkRequestForm', () => {
  it('accepts a quote with only brief', () => {
    const r = parseWorkRequestForm({
      text: '@бот\nЧто посчитать: брендинг 1, 2',
      topicRole: 'QUOTE',
      attachments: [],
    });
    expect(r).toEqual({
      ok: true,
      data: expect.objectContaining({ kind: 'QUOTE', brief: 'брендинг 1, 2', booking: null }),
    });
  });

  it('rejects a quote without brief', () => {
    const r = parseWorkRequestForm({
      text: '@бот\nЧто посчитать:',
      topicRole: 'QUOTE',
      attachments: [],
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('Что посчитать');
  });

  it('rejects booking that is not 6 digits', () => {
    const r = parseWorkRequestForm({
      text: '@бот\nТип: макет\nБронь: 123-456\nТЗ: x\nНазвание позиции под брендинг: стойка',
      topicRole: 'DESIGN',
      attachments: [{ type: 'document' }],
    });
    expect(r.ok).toBe(false);
    expect(r.missing.some((m) => /бронь/i.test(m))).toBe(true);
  });

  it('accepts layout with file and blank logo url', () => {
    const r = parseWorkRequestForm({
      text: [
        '@бот',
        'Тип: макет',
        'Бронь: 123456',
        'ТЗ: лого на стойку',
        'Название позиции под брендинг: стойка',
        'Ссылка на логотип / шрифт / брендбук:',
      ].join('\n'),
      topicRole: 'DESIGN',
      attachments: [{ type: 'document' }],
    });
    expect(r.ok).toBe(true);
    expect(r.data.kind).toBe('LAYOUT');
    expect(r.data.booking).toBe('123456');
  });

  it('rejects layout without url and without file', () => {
    const r = parseWorkRequestForm({
      text: '@бот\nТип: макет\nБронь: 123456\nТЗ: x\nНазвание позиции под брендинг: y',
      topicRole: 'DESIGN',
      attachments: [],
    });
    expect(r.ok).toBe(false);
    expect(r.missing.some((m) => /ссылка или файл/i.test(m))).toBe(true);
  });

  it('accepts visual with layouts url and no file', () => {
    const r = parseWorkRequestForm({
      text: [
        '@бот',
        'Тип: визуализация',
        'Бронь: 654321',
        'ТЗ: визуал',
        'Название позиции под брендинг: бар',
        'Ссылка на макеты: https://disk.example/a',
      ].join('\n'),
      topicRole: 'DESIGN',
      attachments: [],
    });
    expect(r.ok).toBe(true);
    expect(r.data.kind).toBe('VISUAL');
    expect(r.data.layoutsUrl).toBe('https://disk.example/a');
  });

  it('accepts review проверить + file', () => {
    const r = parseWorkRequestForm({
      text: [
        '@бот',
        'Бронь: 111222',
        'Комментарий: проверить',
        'Ссылка на макеты:',
        'Название позиции под брендинг: куб',
      ].join('\n'),
      topicRole: 'REVIEW',
      attachments: [{ type: 'photo' }],
    });
    expect(r.ok).toBe(true);
    expect(r.data.reviewAction).toBe('CHECK');
    expect(r.data.kind).toBe('REVIEW');
  });

  it('rejects review comment other than проверить/запускаем', () => {
    const r = parseWorkRequestForm({
      text: '@бот\nБронь: 111222\nКомментарий: срочно\nСсылка на макеты: https://x.test\nНазвание позиции под брендинг: куб',
      topicRole: 'REVIEW',
      attachments: [],
    });
    expect(r.ok).toBe(false);
  });

  it('accepts review запускаем + file as LAUNCH', () => {
    const r = parseWorkRequestForm({
      text: [
        '@бот',
        'Бронь: 111222',
        'Комментарий: запускаем',
        'Ссылка на макеты:',
        'Название позиции под брендинг: куб',
      ].join('\n'),
      topicRole: 'REVIEW',
      attachments: [{ type: 'document' }],
    });
    expect(r.ok).toBe(true);
    expect(r.data.reviewAction).toBe('LAUNCH');
    expect(r.data.kind).toBe('REVIEW');
  });

  describe('DESIGN mandatory field omissions', () => {
    const baseLayout = [
      '@бот',
      'Тип: макет',
      'Бронь: 123456',
      'ТЗ: лого на стойку',
      'Название позиции под брендинг: стойка',
      'Ссылка на логотип / шрифт / брендбук:',
    ].join('\n');
    const attachments = [{ type: 'document' }];

    it('rejects missing Тип', () => {
      const text = baseLayout.replace('Тип: макет\n', '');
      const r = parseWorkRequestForm({ text, topicRole: 'DESIGN', attachments });
      expect(r.ok).toBe(false);
      expect(r.missing).toContain('Тип');
    });

    it('rejects missing ТЗ', () => {
      const text = baseLayout.replace('ТЗ: лого на стойку\n', '');
      const r = parseWorkRequestForm({ text, topicRole: 'DESIGN', attachments });
      expect(r.ok).toBe(false);
      expect(r.missing).toContain('ТЗ');
    });

    it('rejects missing Название позиции', () => {
      const text = baseLayout.replace('Название позиции под брендинг: стойка\n', '');
      const r = parseWorkRequestForm({ text, topicRole: 'DESIGN', attachments });
      expect(r.ok).toBe(false);
      expect(r.missing).toContain('Название позиции под брендинг');
    });

    it('rejects missing Бронь', () => {
      const text = baseLayout.replace('Бронь: 123456\n', '');
      const r = parseWorkRequestForm({ text, topicRole: 'DESIGN', attachments });
      expect(r.ok).toBe(false);
      expect(r.missing.some((m) => /бронь/i.test(m))).toBe(true);
    });
  });

  describe('REVIEW mandatory field omissions', () => {
    const baseReview = [
      '@бот',
      'Бронь: 111222',
      'Комментарий: проверить',
      'Ссылка на макеты:',
      'Название позиции под брендинг: куб',
    ].join('\n');
    const attachments = [{ type: 'photo' }];

    it('rejects missing Бронь', () => {
      const text = baseReview.replace('Бронь: 111222\n', '');
      const r = parseWorkRequestForm({ text, topicRole: 'REVIEW', attachments });
      expect(r.ok).toBe(false);
      expect(r.missing.some((m) => /бронь/i.test(m))).toBe(true);
    });

    it('rejects missing Комментарий', () => {
      const text = baseReview.replace('Комментарий: проверить\n', '');
      const r = parseWorkRequestForm({ text, topicRole: 'REVIEW', attachments });
      expect(r.ok).toBe(false);
      expect(r.missing).toContain('Комментарий');
    });

    it('rejects missing Название позиции', () => {
      const text = baseReview.replace(
        'Название позиции под брендинг: куб',
        'Название позиции под брендинг:',
      );
      const r = parseWorkRequestForm({ text, topicRole: 'REVIEW', attachments });
      expect(r.ok).toBe(false);
      expect(r.missing).toContain('Название позиции под брендинг');
    });
  });

  describe('booking boundaries', () => {
    const designBase = (booking) =>
      [
        '@бот',
        'Тип: макет',
        `Бронь: ${booking}`,
        'ТЗ: x',
        'Название позиции под брендинг: y',
      ].join('\n');
    const attachments = [{ type: 'document' }];

    it('rejects 5-digit booking', () => {
      const r = parseWorkRequestForm({
        text: designBase('12345'),
        topicRole: 'DESIGN',
        attachments,
      });
      expect(r.ok).toBe(false);
      expect(r.missing.some((m) => /бронь/i.test(m))).toBe(true);
    });

    it('rejects prefixed booking text', () => {
      const r = parseWorkRequestForm({
        text: designBase('бронь 123456'),
        topicRole: 'DESIGN',
        attachments,
      });
      expect(r.ok).toBe(false);
      expect(r.missing.some((m) => /бронь/i.test(m))).toBe(true);
    });

    it('rejects 7-digit booking', () => {
      const r = parseWorkRequestForm({
        text: designBase('1234567'),
        topicRole: 'DESIGN',
        attachments,
      });
      expect(r.ok).toBe(false);
      expect(r.missing.some((m) => /бронь/i.test(m))).toBe(true);
    });
  });

  describe('carrier requirements', () => {
    it('accepts visual with file and blank layouts url', () => {
      const r = parseWorkRequestForm({
        text: [
          '@бот',
          'Тип: визуализация',
          'Бронь: 654321',
          'ТЗ: визуал',
          'Название позиции под брендинг: бар',
          'Ссылка на макеты:',
        ].join('\n'),
        topicRole: 'DESIGN',
        attachments: [{ type: 'photo' }],
      });
      expect(r.ok).toBe(true);
      expect(r.data.kind).toBe('VISUAL');
      expect(r.data.layoutsUrl).toBeNull();
      expect(r.data.hasCarrier).toBe(true);
    });

    it('rejects review without url and without file', () => {
      const r = parseWorkRequestForm({
        text: [
          '@бот',
          'Бронь: 111222',
          'Комментарий: проверить',
          'Ссылка на макеты:',
          'Название позиции под брендинг: куб',
        ].join('\n'),
        topicRole: 'REVIEW',
        attachments: [],
      });
      expect(r.ok).toBe(false);
      expect(r.missing.some((m) => /ссылка или файл/i.test(m))).toBe(true);
    });
  });

  describe('blank synonyms as brief fields', () => {
    it.each(['-', 'нет', 'файл'])('rejects QUOTE when Что посчитать is %j', (value) => {
      const r = parseWorkRequestForm({
        text: `@бот\nЧто посчитать: ${value}`,
        topicRole: 'QUOTE',
        attachments: [],
      });
      expect(r.ok).toBe(false);
      expect(r.missing).toContain('Что посчитать');
    });

    it.each(['-', 'нет', 'файл'])('rejects DESIGN when ТЗ is %j', (value) => {
      const r = parseWorkRequestForm({
        text: [
          '@бот',
          'Тип: макет',
          'Бронь: 123456',
          `ТЗ: ${value}`,
          'Название позиции под брендинг: стойка',
        ].join('\n'),
        topicRole: 'DESIGN',
        attachments: [{ type: 'document' }],
      });
      expect(r.ok).toBe(false);
      expect(r.missing).toContain('ТЗ');
    });
  });
});

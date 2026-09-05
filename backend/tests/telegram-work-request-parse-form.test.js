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
});

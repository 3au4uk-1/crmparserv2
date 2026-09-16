import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  buildPrintSheetRowValues,
  resolvePrintSheetDealLabel,
} from '../src/services/print-sheet-row-builder.js';

describe('buildPrintSheetRowValues', () => {
  const lineItem = {
    name: 'Тайсон',
    kommentariy: 'общий комментарий из Tony',
    kommentariyDlyaPechati: 'пленка бб + лам по коп-ву',
    dataGotovnostiPechati: '2026-06-27',
    vremyaGotovnostiPechati: '10:00',
    ssylkaNaMakety: { primaryLinkUrl: 'https://disk.yandex.ru/mock' },
    updatedBy: { name: { firstName: 'Андрей', lastName: 'Абалин' } },
    opportunity: {
      name: 'ПРО/27.06/ИП Рыбаков/Самолет Тайсон ЛСК',
      companyId: '8814cccb-471e-4d05-90cb-261a9395ada8',
      bitrixLink: { primaryLinkUrl: 'https://prointeractive.bitrix24.ru/crm/deal/details/123/' },
    },
  };

  it('print row uses parent name and canonical Bitrix', () => {
    const values = buildPrintSheetRowValues(lineItem, {
      groupLabel: {
        name: 'А7',
        bitrixUrl: 'https://prointeractive.bitrix24.ru/crm/deal/details/2049067/?any',
      },
    });
    expect(values[1]).toBe('А7');
    expect(values[2]).toContain('2049067');
  });

  it('builds B–P array: print comment in column P, not general kommentariy', () => {
    const row = buildPrintSheetRowValues(lineItem);
    expect(row).toHaveLength(15);
    expect(row[0]).toBe('Про');
    expect(row[8]).toBe('10:00');
    expect(row[9]).toBe('');
    expect(row[14]).toBe('пленка бб + лам по коп-ву');
    expect(row).not.toContain('общий комментарий из Tony');
  });

  it('leaves department empty when company unmapped', () => {
    const row = buildPrintSheetRowValues({
      ...lineItem,
      opportunity: { ...lineItem.opportunity, companyId: 'unknown' },
    });
    expect(row[0]).toBe('');
  });

  it('resolves responsible via workspaceMemberId', () => {
    const row = buildPrintSheetRowValues(
      {
        ...lineItem,
        updatedBy: { workspaceMemberId: 'wm-1', name: 'ignored' },
      },
      {
        workspaceMemberById: {
          'wm-1': { name: { firstName: 'Василий', lastName: 'Добжанский' } },
        },
      }
    );
    expect(row[6]).toBe('Василий Добжанский');
  });

  it('writes restoration checkbox to column F', () => {
    const row = buildPrintSheetRowValues({
      ...lineItem,
      restavraciyaPechati: true,
    });
    expect(row[4]).toBe('TRUE');
  });

  it('writes FALSE to column F when restoration unchecked', () => {
    const row = buildPrintSheetRowValues(lineItem);
    expect(row[4]).toBe('FALSE');
  });
});

describe('resolvePrintSheetDealLabel', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE deals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        twenty_id TEXT,
        title TEXT
      );
      CREATE TABLE deal_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        canonical_deal_id INTEGER NOT NULL REFERENCES deals(id),
        canonical_bitrix_id TEXT NOT NULL
      );
      CREATE TABLE deal_group_members (
        group_id INTEGER NOT NULL REFERENCES deal_groups(id) ON DELETE CASCADE,
        deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
        UNIQUE (deal_id)
      );
    `);
  });
  afterEach(() => db.close());

  it('returns parent name and canonical Bitrix URL when opportunity is grouped', () => {
    db.prepare('INSERT INTO deals (twenty_id, title) VALUES (?, ?)').run('opp-child', 'Child smeta');
    db.prepare('INSERT INTO deals (twenty_id, title) VALUES (?, ?)').run('opp-canon', 'Canon smeta');
    db.prepare(`
      INSERT INTO deal_groups (name, canonical_deal_id, canonical_bitrix_id)
      VALUES ('А7', 2, '2049067')
    `).run();
    db.prepare('INSERT INTO deal_group_members (group_id, deal_id) VALUES (1, 1)').run();
    db.prepare('INSERT INTO deal_group_members (group_id, deal_id) VALUES (1, 2)').run();

    const label = resolvePrintSheetDealLabel(db, 'opp-child', {
      name: 'Child smeta',
      bitrixLink: { primaryLinkUrl: 'https://prointeractive.bitrix24.ru/crm/deal/details/2050903/' },
    });
    expect(label.name).toBe('А7');
    expect(label.bitrixUrl).toContain('2049067');
  });

  it('falls back to opportunity fields when not grouped', () => {
    db.prepare('INSERT INTO deals (twenty_id, title) VALUES (?, ?)').run('opp-solo', 'Solo');
    const label = resolvePrintSheetDealLabel(db, 'opp-solo', {
      name: 'Solo',
      bitrixLink: { primaryLinkUrl: 'https://prointeractive.bitrix24.ru/crm/deal/details/123/' },
    });
    expect(label).toEqual({
      name: 'Solo',
      bitrixUrl: 'https://prointeractive.bitrix24.ru/crm/deal/details/123/',
    });
  });
});


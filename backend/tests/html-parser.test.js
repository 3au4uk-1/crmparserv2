import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseDealDescription } from '../src/services/html-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(
  join(__dirname, 'fixtures', 'deal-description.html'),
  'utf8'
);

describe('parseDealDescription', () => {
  it('extracts deal metadata from fixture HTML', () => {
    const { meta } = parseDealDescription(fixtureHtml);
    expect(meta.status).toBe('Мероприятие проведено');
    expect(meta.legalEntity).toBe('ИП Ухловский');
    expect(meta.invoiceNumber).toBe('913');
    expect(meta.budget).toBe(1087408.04);
  });

  it('extracts contact fields from fixture HTML', () => {
    const { contact } = parseDealDescription(fixtureHtml);
    expect(contact.name).toBe('Чернов Михаил');
    expect(contact.email).toBe('mchernov@iconagency.ru');
    expect(contact.company).toBe('ПРОМО ПОЛЕ');
  });

  it('extracts event address from fixture HTML', () => {
    const { event } = parseDealDescription(fixtureHtml);
    expect(event.address).toBe('Краснодарский край, г Сочи');
  });

  it('parses three line items from the items table', () => {
    const { items } = parseDealDescription(fixtureHtml);
    expect(items).toHaveLength(3);
  });

  it('parses branding line item price and quantity', () => {
    const { items } = parseDealDescription(fixtureHtml);
    const branding = items.find((item) => item.name === 'Брендинг стены');
    expect(branding).toBeDefined();
    expect(branding.price).toBe(161364);
    expect(branding.quantity).toBe('2 шт.');
  });

  it('returns empty items and empty status for empty HTML', () => {
    const result = parseDealDescription('');
    expect(result.items).toEqual([]);
    expect(result.meta.status).toBe('');
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseTonyOrder } from '../src/services/tony-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, 'fixtures/tony-order-169120.html'), 'utf-8');

describe('parseTonyOrder', () => {
  const parsed = parseTonyOrder(html);

  it('extracts all positions across category tables', () => {
    expect(parsed.items).toHaveLength(3);
    const names = parsed.items.map((i) => i.name);
    expect(names).toContain('Навигационные наклейки');
    expect(names).toContain('Ролл апп 85х200');
    expect(names).toContain('Монтажник');
  });

  it('parses comment from custom_text_value', () => {
    const banner = parsed.items.find((i) => i.name === 'Навигационные наклейки');
    expect(banner.comment).toBe('+ монтаж');
    const rollup = parsed.items.find((i) => i.name === 'Ролл апп 85х200');
    expect(rollup.comment).toBe('');
  });

  it('captures separate price, quantity, discount, sum and category', () => {
    const banner = parsed.items.find((i) => i.name === 'Навигационные наклейки');
    expect(banner.price).toBe(2640);
    expect(banner.quantity).toBe('9');
    expect(banner.discount).toBe(0);
    expect(banner.sum).toBe(23760);
    expect(banner.category).toBe('products');

    const personnel = parsed.items.find((i) => i.name === 'Монтажник');
    expect(personnel.category).toBe('personnel');
  });

  it('parses dates including the load date/time', () => {
    expect(parsed.dates.loadDate).toBe('16.06.2026');
    expect(parsed.dates.loadTime).toBe('04:00');
    expect(parsed.dates.eventBegin).toBe('16.06.2026');
    expect(parsed.dates.eventEnd).toBe('17.06.2026');
    expect(parsed.dates.deinstallDate).toBe('17.06.2026');
    expect(parsed.dates.deinstallTime).toBe('01:00');
    expect(parsed.dates.workTimeBegin).toBe('11:00');
    expect(parsed.dates.workTimeEnd).toBe('21:00');
  });

  it('parses the address', () => {
    expect(parsed.address).toBe('г Москва, Ленинградское шоссе, д 46');
  });

  it('sums the budget from line sums', () => {
    expect(parsed.budget).toBe(23760 + 14400 + 5000);
  });

  it('returns empty result for blank html', () => {
    const empty = parseTonyOrder('');
    expect(empty.items).toEqual([]);
    expect(empty.budget).toBe(0);
  });

  it('parses comment from product_text_value for catalog product rows', () => {
    const productHtml = `
      <table data-src="order_products_list" data-var="products"><tbody>
        <tr data-id="954636" data-price="0" data-sum="0">
          <td><a class="item_name_link">БРЕНДИНГ свободная запись ( КОМЕНТАРИЙ ОБЯЗАТЕЛЕН )</a></td>
          <td><input type="text" value="Брус 3 метра - 20 шт." class="product_text_value"></td>
          <td><input type="number" value="1" class="orders_edit"></td>
          <td><input type="text" value="0" class="price_value"></td>
          <td><input type="text" value="0" class="discount_value"></td>
        </tr>
      </tbody></table>
    `;
    const parsed = parseTonyOrder(productHtml);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].comment).toBe('Брус 3 метра - 20 шт.');
  });

  it('parses AJAX-loaded catalog rows with item_name_link and orders_edit', () => {
    const ajaxHtml = `
      <table data-src="order_products_list" data-var="products"><tbody>
        <tr data-id="706928" data-price="50" data-sum="7500">
          <td><a class="item_name_link">Капсулы для аппарата хватайка</a></td>
          <td><input class="orders_edit" value="150"></td>
          <td><input class="price_value" value="50"></td>
          <td><input class="discount_value" value="20"></td>
        </tr>
      </tbody></table>
    `;
    const parsed = parseTonyOrder(ajaxHtml);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      name: 'Капсулы для аппарата хватайка',
      price: 50,
      quantity: '150',
      discount: 20,
      sum: 7500,
      category: 'products',
    });
  });
});

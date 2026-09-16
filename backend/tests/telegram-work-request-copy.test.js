import { describe, expect, it } from 'vitest';
import {
  REFUSAL_NEW_MESSAGE,
  buildRefusalText,
  buildAcceptedText,
} from '../src/telegram/work-requests/copy.js';

describe('copy', () => {
  it('refusal always asks for a new message', () => {
    const text = buildRefusalText(['Бронь — 6 цифр, пример: 123456']);
    expect(text).toContain('Бронь');
    expect(text.endsWith(REFUSAL_NEW_MESSAGE)).toBe(true);
  });
  it('accepted names the number', () => {
    expect(buildAcceptedText(42)).toBe(
      'Запрос #42 принят. Ответ появится в этом сообщении.',
    );
  });
});

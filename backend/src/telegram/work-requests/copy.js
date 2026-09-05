export const REFUSAL_NEW_MESSAGE =
  'Не редактируй это сообщение — напиши новое с формой и тегом.';

export function buildRefusalText(missing) {
  const bullets = missing.map((item) => `- ${item}`).join('\n');
  return `${bullets}\n\n${REFUSAL_NEW_MESSAGE}`;
}

export function buildAcceptedText(requestNumber) {
  return `Запрос #${requestNumber} принят. Ответ появится в этом сообщении.`;
}

export function buildCreateFailedText() {
  return 'Не удалось взять в работу, напиши новое сообщение через минуту.';
}

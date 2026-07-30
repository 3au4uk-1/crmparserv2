/** Telegram webhook handler — stub until inbound callbacks are implemented. */
export function handleTelegramWebhook(_req, res) {
  res.status(501).json({ ok: false, error: 'not_implemented' });
}

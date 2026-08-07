import { Router } from 'express';

import { config } from '../config.js';
import { getEventJournal, isTwentyEventsEnabled } from '../services/twenty-events/index.js';
import { mapWebhookToRecordEvent } from '../services/twenty-events/webhook-event.js';
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifyTwentyWebhookSignature,
} from '../services/twenty-events/webhook-signature.js';

const router = Router();

// Twenty times the delivery out after 5s and retries on non-2xx, so anything we
// deliberately skip is still acknowledged with 200.
router.post('/', (req, res) => {
  const verified = verifyTwentyWebhookSignature({
    rawBody: req.rawBody ?? JSON.stringify(req.body ?? {}),
    timestampHeader: req.headers[TIMESTAMP_HEADER],
    signatureHeader: req.headers[SIGNATURE_HEADER],
    secret: config.twentyWebhookSecret,
  });

  if (!verified.ok) {
    console.warn(`[twenty-events] webhook rejected: ${verified.reason}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!isTwentyEventsEnabled()) {
    return res.json({ ignored: 'disabled' });
  }

  const journal = getEventJournal();
  if (!journal) {
    return res.json({ ignored: 'journal not ready' });
  }

  const event = mapWebhookToRecordEvent(req.body);
  if (!event) {
    return res.json({ ignored: 'unsupported payload' });
  }

  journal.append(event);
  res.json({ ok: true });
});

export default router;

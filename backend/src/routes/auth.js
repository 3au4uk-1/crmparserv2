import { Router } from 'express';
import { config } from '../config.js';
import {
  createSessionToken,
  isAuthRequired,
  extractBearerToken,
  verifySessionToken,
} from '../middleware/app-auth.js';

const router = Router();

router.get('/status', (req, res) => {
  const required = isAuthRequired();
  const token = extractBearerToken(req);
  res.json({
    required,
    authenticated: !required || verifySessionToken(token),
  });
});

router.post('/login', (req, res) => {
  if (!isAuthRequired()) {
    return res.json({ success: true, token: null });
  }

  const { password } = req.body;
  if (password !== config.appPassword) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }

  res.json({ success: true, token: createSessionToken() });
});

export default router;

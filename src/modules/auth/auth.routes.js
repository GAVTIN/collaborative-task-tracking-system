import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import * as authService from './auth.service.js';
import { loginBody, registerBody } from './auth.schemas.js';

const router = Router();

// POST /api/auth/register - create an account (user story 1)
router.post('/register', authLimiter, validate({ body: registerBody }), async (req, res) => {
  const session = await authService.register(req.valid.body);
  res.status(201).json({ data: session });
});

// POST /api/auth/login - exchange credentials for a JWT (user story 2)
router.post('/login', authLimiter, validate({ body: loginBody }), async (req, res) => {
  const session = await authService.login(req.valid.body);
  res.json({ data: session });
});

// POST /api/auth/logout - revoke the token used for this request (user story 12)
router.post('/logout', authenticate, (req, res) => {
  authService.logout(req.auth);
  res.status(204).end();
});

export default router;

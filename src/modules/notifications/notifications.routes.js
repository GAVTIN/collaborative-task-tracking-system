import { Router } from 'express';
import { z } from 'zod';
import { prepare } from '../../db/index.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { HttpError } from '../../utils/http-error.js';
import { id, pagination, queryBoolean } from '../../utils/schemas.js';
import hub, { formatSse } from './hub.js';
import * as notifications from './notifications.service.js';
import { consumeTicket, issueTicket } from './stream-tickets.js';

const router = Router();

const listQuery = z.object({ unread: queryBoolean.optional(), ...pagination });
const idParams = z.object({ id });

/**
 * Authentication for the SSE endpoint: either a one-time `?ticket=` (for browser EventSource, which cannot
 * set headers) or the normal `Authorization: Bearer` header (for fetch-based clients).
 */
function authenticateStream(req, res, next) {
  const ticket = req.query.ticket;
  if (typeof ticket === 'string' && ticket.length > 0) {
    const userId = consumeTicket(ticket);
    const user = userId ? prepare('SELECT id, name, email FROM users WHERE id = ?').get(userId) : null;
    if (!user) throw HttpError.unauthorized('Invalid or expired stream ticket', 'INVALID_TICKET');
    req.user = user;
    return next();
  }
  return authenticate(req, res, next);
}

// GET /api/notifications/stream - real-time notifications over Server-Sent Events (user story 13)
router.get('/stream', authenticateStream, (req, res) => {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tell nginx not to buffer the stream
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n'); // reconnect delay hint for EventSource

  // Resume support: on reconnect the browser sends the id of the last event it saw.
  const lastEventId = Number.parseInt(req.get('last-event-id') ?? '', 10);
  if (Number.isInteger(lastEventId) && lastEventId >= 0) {
    for (const missed of notifications.listSince(req.user.id, lastEventId)) {
      res.write(formatSse({ event: 'notification', id: missed.id, data: missed }));
    }
  }

  res.write(formatSse({ event: 'ready', data: { unread: notifications.unreadCount(req.user.id) } }));

  // Everything above is synchronous, so no notification can slip in between replay and subscribe.
  const unsubscribe = hub.subscribe(req.user.id, res);
  res.on('close', unsubscribe);
});

// POST /api/notifications/stream-ticket - short-lived one-time ticket for EventSource clients
router.post('/stream-ticket', authenticate, (req, res) => {
  res.status(201).json({ data: issueTicket(req.user.id) });
});

// GET /api/notifications?unread=true&page=1&limit=20
router.get('/', authenticate, validate({ query: listQuery }), (req, res) => {
  res.json(notifications.listNotifications(req.user.id, req.valid.query));
});

// GET /api/notifications/unread-count
router.get('/unread-count', authenticate, (req, res) => {
  res.json({ data: { count: notifications.unreadCount(req.user.id) } });
});

// POST /api/notifications/read-all
router.post('/read-all', authenticate, (req, res) => {
  res.json({ data: { updated: notifications.markAllRead(req.user.id) } });
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', authenticate, validate({ params: idParams }), (req, res) => {
  res.json({ data: notifications.markRead(req.user.id, req.valid.params.id) });
});

export default router;

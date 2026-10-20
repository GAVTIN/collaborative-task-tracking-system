import crypto from 'node:crypto';

/**
 * One-time, 30-second "stream tickets".
 *
 * The browser `EventSource` API cannot send an Authorization header, and putting the long-lived JWT in a
 * URL is risky (URLs end up in logs and browser history). Instead the client first calls
 * `POST /api/notifications/stream-ticket` (normal bearer auth) and then opens
 * `GET /api/notifications/stream?ticket=...`. The ticket works exactly once and dies after 30 seconds,
 * so a leaked URL is worthless.
 *
 * Clients using `fetch()` streaming can skip tickets and send the Authorization header directly.
 */
const TTL_MS = 30_000;

/** @type {Map<string, { userId: number, expiresAt: number }>} */
const tickets = new Map();

function purgeExpired() {
  const now = Date.now();
  for (const [ticket, entry] of tickets) {
    if (entry.expiresAt <= now) tickets.delete(ticket);
  }
}

export function issueTicket(userId) {
  purgeExpired();
  const ticket = crypto.randomBytes(24).toString('base64url');
  tickets.set(ticket, { userId, expiresAt: Date.now() + TTL_MS });
  return { ticket, expiresIn: TTL_MS / 1000 };
}

/** Returns the user id for a valid ticket and burns it, otherwise `null`. */
export function consumeTicket(ticket) {
  const entry = tickets.get(ticket);
  tickets.delete(ticket); // single use, even when expired
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.userId;
}

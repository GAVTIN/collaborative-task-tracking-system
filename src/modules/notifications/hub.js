/**
 * In-memory Server-Sent Events hub.
 *
 * Keeps track of which HTTP responses (open SSE streams) belong to which user and pushes
 * notifications to them the moment they are created. Because it lives in process memory it works for a
 * single server instance; to scale horizontally, replace `publish` with Redis pub/sub (or similar) -
 * nothing else in the code base needs to change.
 *
 * Why SSE instead of WebSockets? Notifications flow one way (server -> client). SSE is plain HTTP,
 * passes through proxies/load balancers easily, reconnects automatically, and resumes missed events via
 * the standard `Last-Event-ID` header.
 */

/** Serialises one SSE frame. */
export function formatSse({ event, id, data }) {
  const idLine = id === undefined ? '' : `id: ${id}\n`;
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const HEARTBEAT_MS = 25_000;

class NotificationHub {
  /** @type {Map<number, Set<import('express').Response>>} */
  #clients = new Map();
  #heartbeat = null;

  /** Registers an open stream for a user; returns an unsubscribe function. */
  subscribe(userId, res) {
    if (!this.#clients.has(userId)) this.#clients.set(userId, new Set());
    this.#clients.get(userId).add(res);
    this.#ensureHeartbeat();

    return () => {
      const streams = this.#clients.get(userId);
      if (!streams) return;
      streams.delete(res);
      if (streams.size === 0) this.#clients.delete(userId);
      if (this.#clients.size === 0) this.#stopHeartbeat();
    };
  }

  /** Pushes a notification to every open stream of the user (a user may have several tabs/devices). */
  publish(userId, notification) {
    const streams = this.#clients.get(userId);
    if (!streams) return;
    const frame = formatSse({ event: 'notification', id: notification.id, data: notification });
    for (const res of streams) res.write(frame);
  }

  connectionCount() {
    let total = 0;
    for (const streams of this.#clients.values()) total += streams.size;
    return total;
  }

  /** Ends every open stream (graceful shutdown). */
  closeAll() {
    for (const streams of this.#clients.values()) {
      for (const res of streams) res.end();
    }
    this.#clients.clear();
    this.#stopHeartbeat();
  }

  // A comment line every 25 s keeps idle connections from being dropped by proxies / load balancers.
  #ensureHeartbeat() {
    if (this.#heartbeat) return;
    this.#heartbeat = setInterval(() => {
      for (const streams of this.#clients.values()) {
        for (const res of streams) res.write(': keep-alive\n\n');
      }
    }, HEARTBEAT_MS);
    this.#heartbeat.unref(); // never keep the process alive just for heartbeats
  }

  #stopHeartbeat() {
    clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }
}

export default new NotificationHub();

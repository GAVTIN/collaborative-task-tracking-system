import { prepare } from '../../db/index.js';
import { HttpError } from '../../utils/http-error.js';
import { buildMeta, toLimitOffset } from '../../utils/pagination.js';
import { nowIso } from '../../utils/time.js';
import hub from './hub.js';

/**
 * Notification types emitted by the application:
 *   task_assigned   you were assigned a task
 *   task_updated    a task you created / are assigned to changed
 *   task_completed  a task you created / are assigned to was completed
 *   task_deleted    a task assigned to you was deleted
 *   task_comment    someone commented on a task you created / are assigned to
 *   task_attachment someone attached a file to a task you created / are assigned to
 *   team_invite     you were invited to a team
 *   invite_accepted someone accepted your team invitation
 */
export function toNotification(row) {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    data: JSON.parse(row.data),
    read: row.read_at !== null,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

/** Persists a notification and, if the user has an open SSE stream, pushes it immediately. */
export function notify(userId, { type, message, data = {} }) {
  const { lastInsertRowid } = prepare(
    'INSERT INTO notifications (user_id, type, message, data) VALUES (?, ?, ?, ?)'
  ).run(userId, type, message, JSON.stringify(data));

  const notification = toNotification(prepare('SELECT * FROM notifications WHERE id = ?').get(lastInsertRowid));
  hub.publish(userId, notification);
  return notification;
}

/**
 * Notifies several users at once, ignoring duplicates / nulls and anyone in `exclude`
 * (typically the actor: nobody needs a notification about their own action).
 */
export function notifyMany(userIds, payload, { exclude = [] } = {}) {
  const skip = new Set(exclude);
  for (const userId of new Set(userIds)) {
    if (userId != null && !skip.has(userId)) notify(userId, payload);
  }
}

export function listNotifications(userId, { unread, page, limit }) {
  const where = unread ? 'user_id = ? AND read_at IS NULL' : 'user_id = ?';
  const { total } = prepare(`SELECT COUNT(*) AS total FROM notifications WHERE ${where}`).get(userId);
  const { limit: take, offset } = toLimitOffset({ page, limit });
  const rows = prepare(`SELECT * FROM notifications WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(
    userId,
    take,
    offset
  );
  return { data: rows.map(toNotification), meta: buildMeta({ page, limit }, total) };
}

export function unreadCount(userId) {
  return prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).count;
}

export function markRead(userId, notificationId) {
  const row = prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(notificationId, userId);
  if (!row) throw HttpError.notFound('Notification not found', 'NOTIFICATION_NOT_FOUND');
  if (row.read_at === null) {
    prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(nowIso(), notificationId);
  }
  return toNotification(prepare('SELECT * FROM notifications WHERE id = ?').get(notificationId));
}

export function markAllRead(userId) {
  return prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(nowIso(), userId)
    .changes;
}

/** Notifications newer than `lastId`, oldest first - used to replay what a reconnecting SSE client missed. */
export function listSince(userId, lastId, limit = 100) {
  return prepare('SELECT * FROM notifications WHERE user_id = ? AND id > ? ORDER BY id ASC LIMIT ?')
    .all(userId, lastId, limit)
    .map(toNotification);
}

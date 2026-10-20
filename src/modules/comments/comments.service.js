import { prepare } from '../../db/index.js';
import { HttpError } from '../../utils/http-error.js';
import { buildMeta, toLimitOffset } from '../../utils/pagination.js';
import { nowIso } from '../../utils/time.js';
import { notifyMany } from '../notifications/notifications.service.js';
import { getAccessibleTask, taskStakeholders } from '../tasks/tasks.service.js';

const COMMENT_SELECT = `
  SELECT c.*, u.name AS author_name
  FROM comments c JOIN users u ON u.id = c.user_id`;

function toComment(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    body: row.body,
    author: { id: row.user_id, name: row.author_name },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const getCommentById = (commentId) => toComment(prepare(`${COMMENT_SELECT} WHERE c.id = ?`).get(commentId));

/** Loads a comment that belongs to the given task, or 404. */
function findCommentOnTask(taskId, commentId) {
  const row = prepare('SELECT * FROM comments WHERE id = ? AND task_id = ?').get(commentId, taskId);
  if (!row) throw HttpError.notFound('Comment not found', 'COMMENT_NOT_FOUND');
  return row;
}

export function addComment(user, taskId, body) {
  const task = getAccessibleTask(taskId, user.id);
  const { lastInsertRowid } = prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)').run(
    taskId,
    user.id,
    body
  );

  const preview = task.title.length > 80 ? `${task.title.slice(0, 79)}…` : task.title;
  notifyMany(
    taskStakeholders(task),
    {
      type: 'task_comment',
      message: `${user.name} commented on the task "${preview}"`,
      data: { taskId, teamId: task.team_id, commentId: Number(lastInsertRowid), actorId: user.id },
    },
    { exclude: [user.id] }
  );
  return getCommentById(lastInsertRowid);
}

/** Oldest first, so the list reads like a conversation. */
export function listComments(user, taskId, { page, limit }) {
  getAccessibleTask(taskId, user.id); // authorisation
  const { total } = prepare('SELECT COUNT(*) AS total FROM comments WHERE task_id = ?').get(taskId);
  const { limit: take, offset } = toLimitOffset({ page, limit });
  const rows = prepare(`${COMMENT_SELECT} WHERE c.task_id = ? ORDER BY c.id ASC LIMIT ? OFFSET ?`).all(
    taskId,
    take,
    offset
  );
  return { data: rows.map(toComment), meta: buildMeta({ page, limit }, total) };
}

/** Only the author may edit their own comment. */
export function updateComment(user, taskId, commentId, body) {
  getAccessibleTask(taskId, user.id);
  const comment = findCommentOnTask(taskId, commentId);
  if (comment.user_id !== user.id) {
    throw HttpError.forbidden('You can only edit your own comments', 'INSUFFICIENT_PERMISSIONS');
  }
  prepare('UPDATE comments SET body = ?, updated_at = ? WHERE id = ?').run(body, nowIso(), commentId);
  return getCommentById(commentId);
}

/** The author may delete their comment; so may an owner/admin of the task's team (moderation). */
export function deleteComment(user, taskId, commentId) {
  const task = getAccessibleTask(taskId, user.id);
  const comment = findCommentOnTask(taskId, commentId);
  const isModerator = ['owner', 'admin'].includes(task.my_role);
  if (comment.user_id !== user.id && !isModerator) {
    throw HttpError.forbidden('You can only delete your own comments', 'INSUFFICIENT_PERMISSIONS');
  }
  prepare('DELETE FROM comments WHERE id = ?').run(commentId);
}

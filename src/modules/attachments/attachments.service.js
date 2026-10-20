import { prepare } from '../../db/index.js';
import { HttpError } from '../../utils/http-error.js';
import { decodeFilename, removeStoredFiles, sanitizeFilename } from '../../utils/files.js';
import { notifyMany } from '../notifications/notifications.service.js';
import { getAccessibleTask, taskStakeholders } from '../tasks/tasks.service.js';

const ATTACHMENT_SELECT = `
  SELECT a.*, u.name AS uploader_name
  FROM attachments a JOIN users u ON u.id = a.uploaded_by`;

function toAttachment(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    fileName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedBy: { id: row.uploaded_by, name: row.uploader_name },
    createdAt: row.created_at,
    downloadUrl: `/api/tasks/${row.task_id}/attachments/${row.id}/download`,
  };
}

function findAttachmentOnTask(taskId, attachmentId) {
  const row = prepare('SELECT * FROM attachments WHERE id = ? AND task_id = ?').get(attachmentId, taskId);
  if (!row) throw HttpError.notFound('Attachment not found', 'ATTACHMENT_NOT_FOUND');
  return row;
}

/**
 * Records an already-stored upload (multer wrote the bytes to disk under `file.filename`).
 * If anything fails here the orphaned file is deleted so the disk never fills with unreferenced uploads.
 */
export async function addAttachment(user, taskId, file) {
  try {
    const task = getAccessibleTask(taskId, user.id);
    const originalName = sanitizeFilename(decodeFilename(file.originalname));

    const { lastInsertRowid } = prepare(
      `INSERT INTO attachments (task_id, uploaded_by, original_name, stored_name, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(taskId, user.id, originalName, file.filename, file.mimetype, file.size);

    notifyMany(
      taskStakeholders(task),
      {
        type: 'task_attachment',
        message: `${user.name} attached "${originalName}" to the task "${task.title.slice(0, 80)}"`,
        data: { taskId, teamId: task.team_id, attachmentId: Number(lastInsertRowid), actorId: user.id },
      },
      { exclude: [user.id] }
    );
    return toAttachment(prepare(`${ATTACHMENT_SELECT} WHERE a.id = ?`).get(lastInsertRowid));
  } catch (err) {
    await removeStoredFiles([file.filename]);
    throw err;
  }
}

export function listAttachments(user, taskId) {
  getAccessibleTask(taskId, user.id);
  return prepare(`${ATTACHMENT_SELECT} WHERE a.task_id = ? ORDER BY a.id ASC`).all(taskId).map(toAttachment);
}

/** Returns what the route needs to stream the file back (after the access check). */
export function getAttachmentForDownload(user, taskId, attachmentId) {
  getAccessibleTask(taskId, user.id);
  const row = findAttachmentOnTask(taskId, attachmentId);
  return { storedName: row.stored_name, fileName: row.original_name, mimeType: row.mime_type };
}

/** The uploader, the task creator, or a team owner/admin may remove an attachment. */
export async function deleteAttachment(user, taskId, attachmentId) {
  const task = getAccessibleTask(taskId, user.id);
  const attachment = findAttachmentOnTask(taskId, attachmentId);
  const allowed =
    attachment.uploaded_by === user.id || task.created_by === user.id || ['owner', 'admin'].includes(task.my_role);
  if (!allowed) {
    throw HttpError.forbidden(
      'Only the uploader, the task creator or a team owner/admin can delete this attachment',
      'INSUFFICIENT_PERMISSIONS'
    );
  }
  prepare('DELETE FROM attachments WHERE id = ?').run(attachmentId);
  await removeStoredFiles([attachment.stored_name]);
}

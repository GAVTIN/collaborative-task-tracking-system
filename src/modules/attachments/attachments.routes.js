import { Router } from 'express';
import { z } from 'zod';
import config from '../../config/index.js';
import { uploadSingleFile } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import { HttpError } from '../../utils/http-error.js';
import { id } from '../../utils/schemas.js';
import { getAccessibleTask } from '../tasks/tasks.service.js';
import * as attachments from './attachments.service.js';

// Mounted at /api/tasks/:taskId/attachments
const router = Router({ mergeParams: true });

const taskParams = z.object({ taskId: id });
const attachmentParams = z.object({ taskId: id, attachmentId: id });

/**
 * Authorisation gate that runs BEFORE multer, so a user who may not see the task cannot even
 * get a byte written to disk.
 */
function requireTaskAccess(req, _res, next) {
  getAccessibleTask(req.valid.params.taskId, req.user.id);
  next();
}

// POST /api/tasks/:taskId/attachments - multipart/form-data with a single field named "file" (user story 10)
router.post('/', validate({ params: taskParams }), requireTaskAccess, uploadSingleFile, async (req, res) => {
  if (!req.file) {
    throw HttpError.unprocessable('Upload a file in the multipart form field named "file"', undefined, 'FILE_REQUIRED');
  }
  const attachment = await attachments.addAttachment(req.user, req.valid.params.taskId, req.file);
  res.status(201).location(attachment.downloadUrl).json({ data: attachment });
});

// GET /api/tasks/:taskId/attachments - metadata of every file on the task
router.get('/', validate({ params: taskParams }), (req, res) => {
  res.json({ data: attachments.listAttachments(req.user, req.valid.params.taskId) });
});

// GET /api/tasks/:taskId/attachments/:attachmentId/download - the file itself
router.get('/:attachmentId/download', validate({ params: attachmentParams }), (req, res, next) => {
  const { taskId, attachmentId } = req.valid.params;
  const file = attachments.getAttachmentForDownload(req.user, taskId, attachmentId);

  // `res.download` forces "Content-Disposition: attachment", so browsers save instead of rendering the file.
  // `nosniff` stops browsers from second-guessing the content type.
  res.download(
    file.storedName,
    file.fileName,
    { root: config.uploads.dir, dotfiles: 'allow', headers: { 'X-Content-Type-Options': 'nosniff' } },
    (err) => {
      if (!err) return;
      // The row exists but the file is gone from disk (or the client hung up).
      if (err.code === 'ENOENT') return next(HttpError.notFound('The stored file is missing', 'FILE_MISSING'));
      return next(err);
    }
  );
});

// DELETE /api/tasks/:taskId/attachments/:attachmentId
router.delete('/:attachmentId', validate({ params: attachmentParams }), async (req, res) => {
  const { taskId, attachmentId } = req.valid.params;
  await attachments.deleteAttachment(req.user, taskId, attachmentId);
  res.status(204).end();
});

export default router;

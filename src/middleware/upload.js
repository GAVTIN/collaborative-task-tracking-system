import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import config from '../config/index.js';
import { HttpError } from '../utils/http-error.js';
import { decodeFilename, sanitizeFilename } from '../utils/files.js';

/**
 * Single-file upload middleware (multipart field name: "file").
 *
 * Safety measures:
 *  - files are written under a random UUID name, so a client-chosen name can never cause path traversal
 *    or overwrite another file;
 *  - the extension must be on an allow-list (no html / svg / js that a browser could execute);
 *  - a hard size limit is enforced while streaming, so oversized uploads are aborted early.
 *
 * IMPORTANT: routes must run their authorisation checks BEFORE this middleware so that nobody can
 * write files to disk without first proving they are allowed to attach to the task.
 */
const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    fs.mkdirSync(config.uploads.dir, { recursive: true });
    cb(null, config.uploads.dir);
  },
  filename(_req, file, cb) {
    const extension = path.extname(sanitizeFilename(decodeFilename(file.originalname))).toLowerCase();
    cb(null, `${crypto.randomUUID()}${extension}`);
  },
});

function fileFilter(_req, file, cb) {
  const extension = path.extname(sanitizeFilename(decodeFilename(file.originalname))).toLowerCase();
  if (!config.uploads.allowedExtensions.has(extension)) {
    const allowed = [...config.uploads.allowedExtensions].join(', ');
    return cb(
      new HttpError(415, 'UNSUPPORTED_FILE_TYPE', `File type "${extension || 'unknown'}" is not allowed. Allowed: ${allowed}`)
    );
  }
  return cb(null, true);
}

export const uploadSingleFile = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.uploads.maxFileSizeBytes, files: 1 },
}).single('file');

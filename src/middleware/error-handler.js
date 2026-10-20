import multer from 'multer';
import config from '../config/index.js';
import { HttpError } from '../utils/http-error.js';

/** 404 for any route that did not match. */
export function notFoundHandler(req, _res, next) {
  next(HttpError.notFound(`Route ${req.method} ${req.path} not found`, 'ROUTE_NOT_FOUND'));
}

/**
 * Central error handler - the only place that turns errors into HTTP responses.
 *
 * Every error response has the same shape so clients need exactly one code path:
 *
 *   { "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [ ... ] } }
 *
 * Unexpected errors are logged server-side and returned as a generic 500 so internals
 * (stack traces, SQL, file paths) never leak to the client.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // If a streaming response (SSE) already started, we cannot send JSON any more.
  if (res.headersSent) return next(err);

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side';
  let details;

  if (err instanceof HttpError) {
    ({ status, code, message, details } = err);
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  } else if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      code = 'FILE_TOO_LARGE';
      message = `File exceeds the ${Math.round(config.uploads.maxFileSizeBytes / 1024 / 1024)} MB limit`;
    } else {
      status = 400;
      code = 'UPLOAD_ERROR';
      message = `Upload failed: ${err.message}`;
    }
  } else if (typeof err?.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
    // A constraint we did not pre-check (usually a race between two requests).
    status = 409;
    code = 'CONSTRAINT_VIOLATION';
    message = 'The request conflicts with existing data';
  } else if (!config.isTest) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  const body = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return res.status(status).json(body);
}

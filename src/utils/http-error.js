/**
 * An error that carries an HTTP status and a stable, machine-readable code.
 *
 * Services throw `HttpError`s; the central error handler (middleware/error-handler.js)
 * turns them into the uniform JSON error envelope. Anything else that gets thrown is
 * treated as an unexpected 500 and its details are never sent to the client.
 */
export class HttpError extends Error {
  /**
   * @param {number} status   HTTP status code
   * @param {string} code     Stable identifier clients can switch on, e.g. "TASK_NOT_FOUND"
   * @param {string} message  Human readable explanation
   * @param {unknown} [details] Optional structured details (e.g. validation issues)
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Bad request', code = 'BAD_REQUEST', details) {
    return new HttpError(400, code, message, details);
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new HttpError(401, code, message);
  }

  static forbidden(message = 'You do not have permission to perform this action', code = 'FORBIDDEN') {
    return new HttpError(403, code, message);
  }

  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new HttpError(404, code, message);
  }

  static conflict(message = 'Conflict', code = 'CONFLICT') {
    return new HttpError(409, code, message);
  }

  static unprocessable(message = 'Request validation failed', details, code = 'VALIDATION_ERROR') {
    return new HttpError(422, code, message, details);
  }
}

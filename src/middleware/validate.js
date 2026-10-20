import { HttpError } from '../utils/http-error.js';

/**
 * Request validation middleware factory.
 *
 *   router.post('/', validate({ body: createSchema }), handler)
 *   router.get('/:id', validate({ params: z.object({ id }) , query: listQuery }), handler)
 *
 * Parsed (coerced, trimmed, defaulted) values are placed on `req.valid.{params,query,body}`.
 * The raw `req.query` / `req.params` are intentionally left untouched - in Express 5 `req.query`
 * is a read-only getter, and keeping raw and validated input separate avoids accidental use of
 * unvalidated data.
 */
export function validate(schemas) {
  return (req, _res, next) => {
    const valid = {};
    const issues = [];

    for (const part of ['params', 'query', 'body']) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        valid[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ path: [part, ...issue.path].join('.'), message: issue.message });
        }
      }
    }

    if (issues.length > 0) return next(HttpError.unprocessable('Request validation failed', issues));

    req.valid = valid;
    return next();
  };
}

/**
 * Builds the `SET` part of a partial UPDATE from a validated patch object.
 *
 * Only columns listed in `columns` (a whitelist mapping API field -> column name) can ever appear in
 * the generated SQL, and values are always bound as named parameters, so user input is never
 * interpolated into the query text.
 *
 * @param {Record<string, unknown>} patch    validated request fields (may be a subset)
 * @param {Record<string, string>} columns   e.g. { jobTitle: 'job_title', name: 'name' }
 * @returns {{ sets: string[], params: Record<string, unknown> }}
 */
export function buildSet(patch, columns) {
  const sets = [];
  const params = {};
  for (const [field, column] of Object.entries(columns)) {
    if (patch[field] !== undefined) {
      sets.push(`${column} = @${field}`);
      params[field] = patch[field];
    }
  }
  return { sets, params };
}

/** Escapes LIKE wildcards so a user searching for "100%" does not match everything. */
export function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

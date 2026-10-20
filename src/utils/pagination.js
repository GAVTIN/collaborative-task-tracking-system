/** Helpers for page/limit pagination. */

/** Converts validated `page` and `limit` into SQL LIMIT / OFFSET numbers. */
export function toLimitOffset({ page, limit }) {
  return { limit, offset: (page - 1) * limit };
}

/** Builds the `meta` block returned alongside list responses. */
export function buildMeta({ page, limit }, total) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

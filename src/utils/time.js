/**
 * Time helpers. All timestamps in this API are ISO 8601 strings in UTC
 * (for example "2026-10-19T11:04:05.123Z"), which sort correctly as plain text.
 */

/** Current time as an ISO 8601 UTC string. */
export const nowIso = () => new Date().toISOString();

/** ISO string `days` days from now. */
export const daysFromNowIso = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

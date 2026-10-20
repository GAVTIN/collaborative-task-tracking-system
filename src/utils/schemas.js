/**
 * Reusable zod building blocks shared by the feature modules.
 */
import { z } from 'zod';

/** A positive integer id, accepted from URL params / query strings ("42" -> 42). */
export const id = z.coerce.number().int().positive();

/** A strict positive integer id for JSON request bodies (unlike `id`, never coerces strings or booleans). */
export const bodyId = z.number().int().positive();

/** Standard `?page=&limit=` query parameters. */
export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

/** Query-string boolean: only the literal strings "true" / "false" are accepted. */
export const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * ISO 8601 date or date-time, normalised to a full UTC ISO string.
 *  - "2026-11-01"                  -> 2026-11-01T00:00:00.000Z   (date only = midnight UTC)
 *  - "2026-11-01T17:30:00+05:30"   -> 2026-11-01T12:00:00.000Z
 * A time without an explicit zone is rejected so the stored value is never ambiguous.
 */
const ISO_DATE_OR_DATETIME =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$/;

/**
 * `Date.parse` is lenient: V8 rolls "2030-02-31" over to March 3 and accepts hour 24. Silently storing a
 * different date than the user typed is a bug, so the date and time parts are checked explicitly.
 */
function isRealCalendarMoment(value) {
  const [, year, month, day, hour, minute, second] =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value) ?? [];
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const dateOk =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);
  const timeOk = hour === undefined || (Number(hour) <= 23 && Number(minute) <= 59 && Number(second ?? 0) <= 59);
  return dateOk && timeOk && !Number.isNaN(Date.parse(value));
}

export const isoDate = z
  .string()
  .trim()
  .regex(ISO_DATE_OR_DATETIME, 'Must be an ISO 8601 date (YYYY-MM-DD) or date-time with a timezone, e.g. 2026-11-01T17:00:00Z')
  .refine(isRealCalendarMoment, 'Not a valid calendar date')
  .transform((value) => new Date(value).toISOString());

/** For PATCH bodies: after `.partial()`, reject `{}` because there would be nothing to update. */
export const hasAtLeastOneField = (body) => Object.keys(body).length > 0;
export const AT_LEAST_ONE_FIELD = 'Provide at least one field to update';

/** Trimmed, non-empty string with a maximum length. */
export const text = (max, label = 'Value') =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} must be at most ${max} characters`);

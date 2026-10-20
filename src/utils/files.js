import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config/index.js';

/**
 * Multipart file names arrive decoded as latin1 even though browsers send UTF-8 bytes.
 * Re-decode so names such as "résumé.pdf" survive; fall back to the raw value if that fails.
 */
export function decodeFilename(raw) {
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('�') ? raw : decoded;
}

/** Strips directory components and control / reserved characters from a client-supplied name. */
export function sanitizeFilename(name) {
  const base = path.basename(String(name).replace(/\\/g, '/'));
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
  return cleaned.slice(0, 200) || 'file';
}

/** Deletes uploaded files from disk. Missing files are ignored; failures never break a request. */
export async function removeStoredFiles(storedNames) {
  await Promise.all(
    storedNames.map((name) =>
      fs.rm(path.join(config.uploads.dir, path.basename(name)), { force: true }).catch(() => {})
    )
  );
}

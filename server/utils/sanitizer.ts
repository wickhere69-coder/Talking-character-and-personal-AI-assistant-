/**
 * Sanitizer & Input Validation Utilities
 * Defense-in-depth against XSS, prototype pollution, path traversal, and malicious inputs.
 */

/**
 * Sanitizes generic user-supplied strings:
 * - Strips null bytes (\0) which can confuse C-based filesystem or OS APIs.
 * - Trims and enforces a maximum character limit to prevent buffer / memory exhaustion.
 */
export function sanitizeString(input: unknown, maxLength = 4000): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/\0/g, '') // remove null bytes
    .slice(0, maxLength)
    .trim();
}

/**
 * Escapes characters that have special meaning in HTML contexts:
 * Prevents Cross-Site Scripting (XSS) when rendering user strings.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Validates identifiers (session IDs, provider names, voice IDs)
 * Must contain only safe alphanumeric and standard delimiter characters.
 */
export function isValidIdentifier(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  return /^[a-zA-Z0-9_\-\.:]{1,128}$/.test(id);
}

/**
 * Validates that a string is a safe HTTP or HTTPS URL:
 * - Must start with http:// or https://
 * - Disallows quotes, backticks, shell operators, and control characters.
 */
export function isSafeHttpUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;
  const clean = url.trim();
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) return false;

  // Disallow shell metacharacters and injection tokens
  if (/["'`$;&|<>^%\\\0\r\n]/.test(clean)) return false;

  try {
    const parsed = new URL(clean);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Recursively cleans an object to strip dangerous prototype pollution keys:
 * __proto__, constructor, prototype
 */
export function sanitizeObject<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject) as unknown as T;
  }

  const cleaned: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    cleaned[key] = typeof val === 'object' && val !== null ? sanitizeObject(val) : val;
  }
  return cleaned as T;
}


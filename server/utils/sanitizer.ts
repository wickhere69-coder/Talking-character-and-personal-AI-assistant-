import dns from 'dns/promises';
import net from 'net';

/**
 * Sanitizer & Input Validation Utilities
 * Defense-in-depth against XSS, prototype pollution, path traversal, SSRF, and malicious inputs.
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

function isForbiddenIpAddress(ip: string): boolean {
  let target = ip.trim().toLowerCase();
  if (target.startsWith('::ffff:')) {
    target = target.slice(7);
  }
  const version = net.isIP(target);
  if (version === 4) {
    const [a, b] = target.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }
  if (version === 6) {
    if (target === '::' || target === '::1') return true;
    if (target.startsWith('fe80:') || target.startsWith('fc') || target.startsWith('fd') || target.startsWith('ff')) {
      return true;
    }
    return false;
  }
  return true;
}

/**
 * Strict SSRF guard: verifies scheme, blocks credentials/internal hosts, and resolves DNS
 * to ensure all target IP addresses belong to public routable networks.
 */
export async function assertSafePublicHttpUrl(rawUrl: unknown): Promise<string> {
  if (!isSafeHttpUrl(rawUrl)) {
    throw new Error('URL must be a valid public http:// or https:// address.');
  }
  const clean = (rawUrl as string).trim();
  const parsed = new URL(clean);
  if (parsed.username || parsed.password) {
    throw new Error('Embedded credentials in URLs are not allowed.');
  }

  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    throw new Error('Access to local or internal hostnames is restricted.');
  }

  if (net.isIP(host)) {
    if (isForbiddenIpAddress(host)) {
      throw new Error('Access to private or loopback IP addresses is restricted.');
    }
    return parsed.toString();
  }

  const records = await dns.lookup(host, { all: true });
  if (!records || records.length === 0) {
    throw new Error('Hostname resolved to no usable IP addresses.');
  }
  for (const rec of records) {
    if (isForbiddenIpAddress(rec.address)) {
      throw new Error('Access to private, loopback, or link-local networks is restricted.');
    }
  }
  return parsed.toString();
}

/**
 * Validates CORS origin strictly via URL hostname parsing (prevents http://localhost:80@evil.com bypass).
 */
export function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  try {
    const parsed = new URL(origin.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
      return true;
    }
    const normalized = `${parsed.protocol}//${parsed.host}`.toLowerCase();
    return allowedOrigins.some((o) => o.replace(/\/+$/, '').toLowerCase() === normalized);
  } catch {
    return false;
  }
}

/**
 * Returns a redacted error message preventing secret or filesystem path exposure in API responses.
 */
export function sanitizeErrorMessage(err: unknown, fallback = 'An unexpected server error occurred.'): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (!raw) return fallback;
  if (/(sk-|sk_|AIza|xai-|sb_secret|Bearer |C:\\|\/Users\/|\/home\/)/i.test(raw)) {
    return fallback;
  }
  return raw.slice(0, 200);
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


import crypto from 'crypto';

// Server-side secret key for signing session tokens (persisted or randomized per server boot)
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

/**
 * Derives a salted hash for passwords or admin secrets using PBKDF2 / scrypt.
 * Output format: "salt:hash" in hex.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verifies a password against a stored "salt:hash" string using timing-safe comparison.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [salt, keyHex] = parts;
    const keyBuffer = Buffer.from(keyHex, 'hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);

    if (keyBuffer.length !== derivedKey.length) return false;
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}

/**
 * Compares two strings in constant time to prevent side-channel timing attacks.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      // Execute dummy comparison to prevent length timing leakage
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export interface AdminTokenPayload {
  role: 'admin';
  iat: number;
  exp: number;
}

/**
 * Creates an HMAC-SHA256 signed session token for authenticated admins.
 * Validity defaults to 8 hours.
 */
export function createAdminToken(expiresInHours = 8): string {
  const payload: AdminTokenPayload = {
    role: 'admin',
    iat: Date.now(),
    exp: Date.now() + expiresInHours * 3600 * 1000
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(payloadBase64)
    .digest('base64url');
  return `${payloadBase64}.${signature}`;
}

/**
 * Validates an HMAC-SHA256 signed admin session token.
 */
export function verifyAdminToken(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return false;

  const [payloadBase64, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(payloadBase64)
    .digest('base64url');

  if (!timingSafeCompare(signature, expectedSignature)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8')) as AdminTokenPayload;
    if (payload.role !== 'admin') return false;
    if (Date.now() > payload.exp) return false; // Token expired
    return true;
  } catch {
    return false;
  }
}


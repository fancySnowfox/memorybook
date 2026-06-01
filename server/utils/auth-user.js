import crypto from 'node:crypto';

const AUTH_COOKIE_NAME = 'mb_auth';
const AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const AUTH_SECRET = process.env.AUTH_COOKIE_SECRET || process.env.SESSION_SECRET || 'change-this-auth-secret';

function toBase64Url(value) {
  return Buffer.from(String(value), 'utf8').toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(String(value), 'base64url').toString('utf8');
}

function signPayload(payload) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
}

export function normalizeUsername(rawValue) {
  return String(rawValue || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 40);
}

export function parseCookies(req) {
  const cookieHeader = req.get?.('cookie') || '';
  const out = {};

  for (const rawEntry of cookieHeader.split(';')) {
    const [rawKey, ...rawValueParts] = rawEntry.split('=');
    const key = String(rawKey || '').trim();
    if (!key) {
      continue;
    }

    const value = rawValueParts.join('=').trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }

  return out;
}

export function createAuthCookieValue(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) {
    throw new Error('Username is required.');
  }

  const issuedAt = Date.now();
  const payload = `${normalized}.${issuedAt}`;
  const signature = signPayload(payload);
  return `${toBase64Url(payload)}.${signature}`;
}

export function readAuthenticatedUsername(req) {
  const cookies = parseCookies(req);
  const token = cookies[AUTH_COOKIE_NAME];
  if (!token) {
    return '';
  }

  const [encodedPayload, signature] = String(token).split('.');
  if (!encodedPayload || !signature) {
    return '';
  }

  let payload = '';
  try {
    payload = fromBase64Url(encodedPayload);
  } catch {
    return '';
  }

  const expectedSignature = signPayload(payload);
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const receivedBuffer = Buffer.from(signature, 'utf8');
  if (expectedBuffer.length !== receivedBuffer.length) {
    return '';
  }

  if (!crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return '';
  }

  const [username, issuedAtRaw] = payload.split('.');
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) {
    return '';
  }

  const ageMs = Date.now() - issuedAt;
  if (ageMs < 0 || ageMs > AUTH_MAX_AGE_SECONDS * 1000) {
    return '';
  }

  return normalizeUsername(username);
}

export function setAuthCookie(res, username) {
  const token = createAuthCookieValue(username);
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: AUTH_MAX_AGE_SECONDS * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res) {
  res.cookie(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(0),
    path: '/',
  });
}

export function getAuthenticatedUser(req) {
  return readAuthenticatedUsername(req);
}

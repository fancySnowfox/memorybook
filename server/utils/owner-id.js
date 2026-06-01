import { getAuthenticatedUser } from './auth-user.js';

function normalizeOwnerId(rawId) {
  const safeId = String(rawId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return safeId || 'anonymous';
}

export function resolveRequestOwnerId(req) {
  const username = getAuthenticatedUser(req);
  if (username) {
    return normalizeOwnerId(`u_${username}`);
  }

  const headerId = req.get?.('X-Browser-Id');
  const queryId = req.query?.bid;
  const bodyId = req.body?.browserId;
  const sessionId = req.session?.id;
  return normalizeOwnerId(headerId || queryId || bodyId || sessionId);
}

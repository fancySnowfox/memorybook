import express from 'express';
import { clearAuthCookie, getAuthenticatedUser, setAuthCookie } from '../utils/auth-user.js';
import { authenticateUser, changeUserPassword, createUser, getUserByUsername } from '../utils/users-store.js';

const router = express.Router();

function jsonError(res, status, message) {
  return res.status(status).json({ ok: false, message });
}

router.get('/status', (req, res) => {
  const username = getAuthenticatedUser(req);
  if (!username) {
    return res.json({ ok: true, authenticated: false, user: null });
  }

  const user = getUserByUsername(username);
  return res.json({
    ok: true,
    authenticated: true,
    user: user ? { id: user.id, username: user.username, createdAt: user.createdAt } : { id: `u_${username}`, username },
  });
});

router.post('/register', express.json(), (req, res) => {
  try {
    const user = createUser({
      username: req.body?.username,
      password: req.body?.password,
    });
    setAuthCookie(res, user.username);
    return res.status(201).json({ ok: true, user });
  } catch (error) {
    return jsonError(res, 400, error instanceof Error ? error.message : 'Registration failed.');
  }
});

router.post('/login', express.json(), (req, res) => {
  const user = authenticateUser({
    username: req.body?.username,
    password: req.body?.password,
  });
  if (!user) {
    return jsonError(res, 401, 'Invalid username or password.');
  }

  setAuthCookie(res, user.username);
  return res.json({ ok: true, user });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

router.post('/change-password', express.json(), (req, res) => {
  const username = getAuthenticatedUser(req);
  if (!username) {
    return jsonError(res, 401, 'Login required.');
  }

  try {
    const user = changeUserPassword({
      username,
      currentPassword: req.body?.currentPassword,
      nextPassword: req.body?.nextPassword,
    });
    return res.json({ ok: true, user });
  } catch (error) {
    return jsonError(res, 400, error instanceof Error ? error.message : 'Password change failed.');
  }
});

export function requireAppLogin(req, res, next) {
  if (getAuthenticatedUser(req)) {
    return next();
  }
  return res.status(401).json({ ok: false, message: 'Login required.' });
}

export default router;

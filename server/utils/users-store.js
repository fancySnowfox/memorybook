import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeUsername } from './auth-user.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const usersFilePath = path.join(projectRoot, 'files', 'users.json');

function ensureUsersFile() {
  fs.mkdirSync(path.dirname(usersFilePath), { recursive: true });
  if (!fs.existsSync(usersFilePath)) {
    fs.writeFileSync(usersFilePath, JSON.stringify({ users: [] }, null, 2));
  }
}

function readUsersFile() {
  ensureUsersFile();
  try {
    const raw = fs.readFileSync(usersFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.users)) {
      return { users: [] };
    }
    return parsed;
  } catch {
    return { users: [] };
  }
}

function writeUsersFile(data) {
  ensureUsersFile();
  fs.writeFileSync(usersFilePath, JSON.stringify(data, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const iterations = 150000;
  const derivedKey = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
  return `${iterations}:${salt}:${derivedKey}`;
}

function verifyPassword(password, passwordHash) {
  const [iterationsRaw, salt, storedHash] = String(passwordHash || '').split(':');
  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || !salt || !storedHash) {
    return false;
  }

  const candidate = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
  const candidateBuffer = Buffer.from(candidate, 'utf8');
  const storedBuffer = Buffer.from(storedHash, 'utf8');
  if (candidateBuffer.length !== storedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(candidateBuffer, storedBuffer);
}

function toUserId(username) {
  return `u_${normalizeUsername(username)}`;
}

export function getAllUsers() {
  return readUsersFile().users;
}

export function getUserByUsername(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) {
    return null;
  }

  return getAllUsers().find((user) => user.username === normalized) || null;
}

export function createUser({ username, password }) {
  const normalized = normalizeUsername(username);
  const trimmedPassword = String(password || '');

  if (!normalized || normalized.length < 3) {
    throw new Error('Username must be at least 3 characters and use letters, numbers, dot, dash, or underscore.');
  }
  if (trimmedPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  if (getUserByUsername(normalized)) {
    throw new Error('That username already exists.');
  }

  const data = readUsersFile();
  const nextUser = {
    id: toUserId(normalized),
    username: normalized,
    passwordHash: hashPassword(trimmedPassword),
    createdAt: new Date().toISOString(),
  };

  data.users.push(nextUser);
  writeUsersFile(data);
  return { id: nextUser.id, username: nextUser.username, createdAt: nextUser.createdAt };
}

export function authenticateUser({ username, password }) {
  const user = getUserByUsername(username);
  if (!user) {
    return null;
  }

  if (!verifyPassword(password, user.passwordHash)) {
    return null;
  }

  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

export function changeUserPassword({ username, currentPassword, nextPassword }) {
  const normalized = normalizeUsername(username);
  const data = readUsersFile();
  const user = data.users.find((entry) => entry.username === normalized);

  if (!user) {
    throw new Error('User account was not found.');
  }
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    throw new Error('Current password is incorrect.');
  }
  if (String(nextPassword || '').length < 8) {
    throw new Error('New password must be at least 8 characters.');
  }

  user.passwordHash = hashPassword(nextPassword);
  user.updatedAt = new Date().toISOString();
  writeUsersFile(data);
  return { id: user.id, username: user.username, updatedAt: user.updatedAt };
}

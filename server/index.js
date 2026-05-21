import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import session from 'express-session';
import { spawn } from 'node:child_process';
import chatRoute, { getModels } from './routes/chat.js';
import { configRoutes } from './routes/config.js';
import { uploadMovMiddleware, convertMovToMp4, getVideoConvertProgress } from './routes/video.js';
import { uploadPdfMiddleware, handlePdfUpload, listFiles, serveFile, deleteFile } from './routes/files.js';
import { checkApiConnectivity } from './utils/health-check.js';
import { getRagStatus, reindexRag } from './utils/rag-llamaindex.js';
import { initFaqMatcher } from './utils/faq-matcher.js';

dotenv.config({ path: '.env.local' });

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const DEBUG_MODE = process.env.DEBUG_MODE === 'true' || process.env.NODE_ENV !== 'production';
const DEBUG_ADMIN_USER = process.env.DEBUG_ADMIN_USER || 'admin';
const DEBUG_ADMIN_PASSWORD = process.env.DEBUG_ADMIN_PASSWORD;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseBasicAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }

  try {
    const base64 = authHeader.slice('Basic '.length);
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function requireDebugAdmin(req, res, next) {
  if (!DEBUG_MODE) {
    res.status(404).send('Not Found');
    return;
  }

  if (!DEBUG_ADMIN_PASSWORD) {
    res.status(500).json({
      status: 'error',
      message: 'DEBUG_ADMIN_PASSWORD is not configured.',
    });
    return;
  }

  const credentials = parseBasicAuth(req.get('authorization'));
  const valid = credentials
    && credentials.username === DEBUG_ADMIN_USER
    && credentials.password === DEBUG_ADMIN_PASSWORD;

  if (!valid) {
    res.set('WWW-Authenticate', 'Basic realm="Debug", charset="UTF-8"');
    res.status(401).json({
      status: 'error',
      message: 'Admin authentication required.',
    });
    return;
  }

  next();
}

function runCommandCheck(command, args = ['-version']) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });

    child.on('error', (error) => {
      resolve({ available: false, command, error: error.message });
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ available: true, command });
        return;
      }

      resolve({
        available: false,
        command,
        error: `Exited with code ${code}`,
      });
    });
  });
}

async function firstAvailableCommand(commands, args) {
  let lastResult = null;

  for (const command of commands) {
    const result = await runCommandCheck(command, args);
    if (result.available) {
      return result;
    }
    lastResult = result;
  }

  return lastResult || { available: false, command: commands[0], error: 'No commands checked' };
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'snowfox-session-secret-change-in-prod',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/chat', (req, res) => {
  res.render('chat');
});

app.get('/widget-demo', (req, res) => {
  res.render('widget-demo');
});

app.get('/debug', requireDebugAdmin, async (req, res) => {
  const ffmpeg = await firstAvailableCommand([
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    './ffmpeg',
    '../FFmpeg/ffmpeg',
    'ffmpeg',
  ], ['-version']);

  const libreOffice = await firstAvailableCommand([
    'soffice',
    'libreoffice',
  ], ['--version']);

  res.json({
    status: 'ok',
    debugMode: DEBUG_MODE,
    runtime: {
      node: process.version,
      platform: process.platform,
      uptimeSeconds: Math.round(process.uptime()),
      pid: process.pid,
    },
    auth: {
      adminUser: DEBUG_ADMIN_USER,
    },
    session: {
      id: req.session?.id || null,
    },
    dependencies: {
      ffmpeg,
      libreOffice,
    },
    timestamp: new Date().toISOString(),
  });
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const gradientBaseUrl = process.env.GRADIENT_BASE_URL || 'https://inference.do-ai.run/v1';
  const gradientApiKey = process.env.GRADIENT_API_KEY;
  const modelId = process.env.AI_MODEL_ID || 'openai-gpt-oss-120b';

  if (!gradientApiKey) {
    return res.status(500).json({
      status: 'error',
      message: 'GRADIENT_API_KEY is not configured',
      timestamp: new Date().toISOString(),
    });
  }

  const healthCheck = await checkApiConnectivity(gradientBaseUrl, gradientApiKey, modelId);
  
  if (!healthCheck.accessible) {
    return res.status(503).json({
      status: 'error',
      message: healthCheck.message,
      baseUrl: gradientBaseUrl,
      timestamp: new Date().toISOString(),
    });
  }

  res.json({
    status: 'ok',
    message: 'API is accessible and configured correctly',
    baseUrl: gradientBaseUrl,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/chat', chatRoute);
app.get('/api/models', getModels);
app.get('/api/config', configRoutes.config);
app.get('/api/video/convert/progress/:progressId', getVideoConvertProgress);
app.post('/api/video/convert', uploadMovMiddleware, convertMovToMp4);

// File management endpoints
app.get('/api/session', (req, res) => res.json({ sessionId: req.session.id }));
app.post('/api/files/upload', uploadPdfMiddleware, handlePdfUpload);
app.get('/api/files', listFiles);
app.get('/api/files/:filename', serveFile);
app.delete('/api/files/:filename', deleteFile);
app.post('/api/files/:filename/delete', deleteFile);

// RAG endpoints
app.get('/api/rag/status', (req, res) => {
  const status = getRagStatus();
  res.json({
    status: 'success',
    rag: status,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/rag/reindex', async (req, res) => {
  try {
    const result = await reindexRag();
    res.json({
      status: 'success',
      message: 'RAG index reindexing completed',
      rag: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('RAG reindex error:', error);
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'RAG reindex failed',
      timestamp: new Date().toISOString(),
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'An error occurred',
      type: 'api_error',
    },
  });
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`\n✓ Express server running at http://localhost:${port}`);
    console.log(`- Home:         http://localhost:${port}/`);
    console.log(`- Chat:         http://localhost:${port}/chat`);
    console.log(`- Widget demo:  http://localhost:${port}/widget-demo\n`);
    // Pre-compute FAQ embeddings in the background so the first query is fast.
    initFaqMatcher().catch((err) => console.warn('[faq-matcher] background init failed:', err.message));
  });

  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`[startup] Port ${port} is in use. Retrying on ${nextPort}...`);
      startServer(nextPort);
      return;
    }

    console.error('[startup] Server failed to start:', error);
    process.exit(1);
  });
}

startServer(PORT);

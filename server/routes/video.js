import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import formidable from 'formidable';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const converterScriptPath = path.join(projectRoot, 'server', 'scripts', 'convert-mov-to-mp4.js');
const persistentConvertedDir = path.join(projectRoot, 'uploads', 'converted-videos');
const conversionProgress = new Map();
const PROGRESS_RETENTION_MS = 30 * 60 * 1000;

const uploadDir = path.join(os.tmpdir(), 'snowfox-video-uploads');
fs.mkdirSync(uploadDir, { recursive: true });

function resolveFormidableFactory() {
  if (typeof formidable === 'function') {
    return formidable;
  }

  if (formidable && typeof formidable.formidable === 'function') {
    return formidable.formidable;
  }

  if (formidable && typeof formidable.default === 'function') {
    return formidable.default;
  }

  return null;
}

function runNodeScript(scriptPath, args, handlers = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';

    function flushBufferedLines(source, force) {
      if (source === 'stdout') {
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || '';
        for (const line of lines) {
          handlers.onLine?.(line, 'stdout');
        }
        if (force && stdoutBuffer) {
          handlers.onLine?.(stdoutBuffer, 'stdout');
          stdoutBuffer = '';
        }
        return;
      }

      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() || '';
      for (const line of lines) {
        handlers.onLine?.(line, 'stderr');
      }
      if (force && stderrBuffer) {
        handlers.onLine?.(stderrBuffer, 'stderr');
        stderrBuffer = '';
      }
    }

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      stdoutBuffer += text;
      flushBufferedLines('stdout', false);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      stderrBuffer += text;
      flushBufferedLines('stderr', false);
    });

    child.on('error', (error) => {
      reject(new Error(`Converter failed to start: ${error.message}`));
    });

    child.on('close', (code) => {
      flushBufferedLines('stdout', true);
      flushBufferedLines('stderr', true);
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Converter exited with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function isValidProgressId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
}

function toSecondsFromTimecode(timecode) {
  if (!timecode || typeof timecode !== 'string') {
    return null;
  }

  const parts = timecode.split(':');
  if (parts.length !== 3) {
    return null;
  }

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }

  return (hours * 3600) + (minutes * 60) + seconds;
}

function setProgress(progressId, patch) {
  if (!progressId) {
    return;
  }

  const current = conversionProgress.get(progressId) || {
    status: 'queued',
    message: 'Queued',
    percent: 0,
    createdAt: new Date().toISOString(),
  };

  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  conversionProgress.set(progressId, next);
}

function scheduleProgressCleanup(progressId) {
  if (!progressId) {
    return;
  }

  setTimeout(() => {
    const entry = conversionProgress.get(progressId);
    if (!entry) {
      return;
    }

    const age = Date.now() - Date.parse(entry.updatedAt || entry.createdAt || 0);
    if (age >= PROGRESS_RETENTION_MS) {
      conversionProgress.delete(progressId);
    }
  }, PROGRESS_RETENTION_MS + 1000);
}

function updateProgressFromLogLine(progressId, line, parseState) {
  if (!progressId || !line) {
    return;
  }

  const attemptMatch = line.match(/Attempt\s+(\d+)\/(\d+)/i);
  if (attemptMatch) {
    parseState.attempt = Number(attemptMatch[1]);
    parseState.attemptTotal = Number(attemptMatch[2]);
    setProgress(progressId, {
      status: 'converting',
      message: `Encoding attempt ${parseState.attempt}/${parseState.attemptTotal}`,
      attempt: parseState.attempt,
      attemptTotal: parseState.attemptTotal,
    });
    return;
  }

  const durationMatch = line.match(/Duration:\s*([0-9:.]+)/i);
  if (durationMatch) {
    const durationSeconds = toSecondsFromTimecode(durationMatch[1]);
    if (durationSeconds) {
      parseState.durationSeconds = durationSeconds;
    }
    return;
  }

  const timeMatch = line.match(/time=\s*([0-9:.]+)/i);
  if (!timeMatch) {
    return;
  }

  const elapsedSeconds = toSecondsFromTimecode(timeMatch[1]);
  if (!elapsedSeconds) {
    return;
  }

  parseState.lastElapsedSeconds = elapsedSeconds;
  const now = Date.now();
  if ((now - parseState.lastEmitMs) < 700) {
    return;
  }
  parseState.lastEmitMs = now;

  let percent = null;
  if (parseState.durationSeconds) {
    percent = Math.min(99, Math.max(1, Math.round((elapsedSeconds / parseState.durationSeconds) * 100)));
  }

  const speedMatch = line.match(/speed=\s*([0-9.]+)x/i);
  const speed = speedMatch ? `${speedMatch[1]}x` : null;

  setProgress(progressId, {
    status: 'converting',
    message: percent ? `Converting... ${percent}%` : 'Converting...',
    percent,
    elapsedSeconds,
    durationSeconds: parseState.durationSeconds || null,
    speed,
    attempt: parseState.attempt || null,
    attemptTotal: parseState.attemptTotal || null,
  });
}

async function removeDirSafe(dirPath) {
  if (!dirPath) {
    return;
  }

  try {
    await fs.promises.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    console.warn('Temporary cleanup failed:', error.message);
  }
}

// Middleware to log Content-Length and bytes received
function logUploadProgress(req, res, next) {
  const contentLength = req.headers['content-length'] ? parseInt(req.headers['content-length'], 10) : null;
  if (!contentLength || isNaN(contentLength)) {
    console.log('[upload] No Content-Length header');
    return next();
  }
  console.log(`[upload] Content-Length: ${contentLength} bytes`);
  let received = 0;
  req.on('data', (chunk) => {
    received += chunk.length;
    // Log every 5MB or on finish
    if (received === contentLength || received % (5 * 1024 * 1024) < chunk.length) {
      console.log(`[upload] Received: ${received} / ${contentLength} bytes (${((received / contentLength) * 100).toFixed(1)}%)`);
    }
  });
  req.on('end', () => {
    console.log(`[upload] Upload complete: ${received} / ${contentLength} bytes`);
  });
  next();
}


// Formidable-based upload middleware with progress logging
function uploadMovMiddleware(req, res, next) {
  const formidableFactory = resolveFormidableFactory();
  if (!formidableFactory) {
    console.error('[formidable] Unable to resolve formidable factory function. Export keys:', Object.keys(formidable || {}));
    res.status(500).json({
      status: 'error',
      message: 'Upload parser initialization failed on server.',
    });
    return;
  }

  const form = formidableFactory({
    uploadDir,
    maxFileSize: 1024 * 1024 * 1024, // 1GB
    multiples: false,
    filter: ({ name, originalFilename, mimetype }) => {
      return /\.mov$/i.test(originalFilename || '');
    },
  });

  form.on('progress', (bytesReceived, bytesExpected) => {
    const percent = bytesExpected > 0 ? ((bytesReceived / bytesExpected) * 100).toFixed(1) : '0.0';
    console.log(`[formidable] Upload progress: ${bytesReceived} / ${bytesExpected} bytes (${percent}%)`);
  });

  form.parse(req, (err, fields, files) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE' || err.message?.includes('maxFileSize')) {
        res.status(413).json({
          status: 'error',
          message: 'Uploaded file is too large. Maximum allowed is 1GB.',
        });
        return;
      }
      res.status(400).json({
        status: 'error',
        message: `Upload failed: ${err.message}`,
      });
      return;
    }
    // Formidable may return arrays for both fields and files. Normalize them.
    const normalizedBody = Object.fromEntries(
      Object.entries(fields || {}).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
    );
    const selectedFile = files?.video || Object.values(files || {})[0] || null;
    const normalizedFile = Array.isArray(selectedFile) ? selectedFile[0] : selectedFile;

    // Attach parsed fields and file to req for downstream handler
    req.body = normalizedBody;
    req.file = normalizedFile;
    next();
  });
}

function parseBooleanFlag(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function createStoredFileName(originalName) {
  const baseName = path.basename(originalName, path.extname(originalName));
  const safeBaseName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'video';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${safeBaseName}-${timestamp}.mp4`;
}


async function convertMovToMp4(req, res) {
  const tempWorkDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'snowfox-video-work-'));
  const progressId = isValidProgressId(req.body?.progressId) ? req.body.progressId : null;
  const parseState = {
    durationSeconds: null,
    lastElapsedSeconds: 0,
    lastEmitMs: 0,
    attempt: null,
    attemptTotal: null,
  };

  if (progressId) {
    setProgress(progressId, {
      status: 'queued',
      message: 'Upload received. Preparing conversion...',
      percent: 0,
    });
  }

  try {

    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No video file uploaded. Use field name "video".',
      });
    }

    // Formidable file object: { filepath, originalFilename, mimetype, size }
    if (!req.file.filepath) {
      return res.status(400).json({
        status: 'error',
        message: 'Uploaded file path not found. Please retry upload.',
      });
    }

    const originalName = req.file.originalFilename || 'video.MOV';
    const inputPath = path.join(tempWorkDir, 'input.mov');
    const outputPath = path.join(tempWorkDir, 'output.mp4');
    await fs.promises.copyFile(req.file.filepath, inputPath);

    const requestedWidthRaw = req.body?.maxWidth;
    const requestedWidth = requestedWidthRaw ? Number(requestedWidthRaw) : null;
    const storePermanently = parseBooleanFlag(req.body?.storePermanently);
    if (requestedWidthRaw && (!Number.isInteger(requestedWidth) || requestedWidth < 320)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid resolution option. Expected width >= 320.',
      });
    }



    if (progressId) {
      setProgress(progressId, {
        status: 'converting',
        message: 'Starting ffmpeg conversion...',
        percent: 1,
      });
    }

    const converterArgs = [
      inputPath,
      outputPath,
      '--max-mb=10',
    ];

    if (requestedWidth) {
      converterArgs.push(`--max-width=${requestedWidth}`);
    }

    await runNodeScript(converterScriptPath, converterArgs, {
      onLine: (line) => updateProgressFromLogLine(progressId, line, parseState),
    });

    const outputStats = await fs.promises.stat(outputPath);
    const outputSizeMb = outputStats.size / (1024 * 1024);
    const downloadName = `${path.basename(originalName, path.extname(originalName))}.mp4`;
    let storedFilePath = null;

    if (storePermanently) {
      await fs.promises.mkdir(persistentConvertedDir, { recursive: true });
      const storedFileName = createStoredFileName(originalName);
      storedFilePath = path.join(persistentConvertedDir, storedFileName);
      await fs.promises.copyFile(outputPath, storedFilePath);
      res.setHeader('X-Stored-File', storedFileName);
    }

    res.setHeader('X-Output-Size-MB', outputSizeMb.toFixed(2));

    if (progressId) {
      setProgress(progressId, {
        status: 'completed',
        message: 'Conversion complete. Download started.',
        percent: 100,
        outputSizeMb: Number(outputSizeMb.toFixed(2)),
      });
      scheduleProgressCleanup(progressId);
    }

    res.download(outputPath, downloadName, async (downloadError) => {
      if (downloadError && !res.headersSent) {
        res.status(500).json({
          status: 'error',
          message: downloadError.message,
        });
      }

      await removeDirSafe(tempWorkDir);
      if (storedFilePath) {
        console.log(`Stored converted file: ${storedFilePath}`);
      }
    });
  } catch (error) {
    console.error('Video conversion error:', error);

    if (progressId) {
      setProgress(progressId, {
        status: 'error',
        message: error instanceof Error ? error.message : 'Video conversion failed',
      });
      scheduleProgressCleanup(progressId);
    }

    if (!res.headersSent) {
      res.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Video conversion failed',
      });
    }

    await removeDirSafe(tempWorkDir);
  }
}

function getVideoConvertProgress(req, res) {
  const progressId = req.params?.progressId;
  if (!isValidProgressId(progressId)) {
    res.status(400).json({
      status: 'error',
      message: 'Invalid progress id.',
    });
    return;
  }

  const progress = conversionProgress.get(progressId);
  if (!progress) {
    res.status(404).json({
      status: 'error',
      message: 'Progress id not found or expired.',
    });
    return;
  }

  res.json({
    status: 'success',
    progress,
  });
}

export { uploadMovMiddleware, convertMovToMp4, getVideoConvertProgress };

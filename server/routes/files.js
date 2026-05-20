import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const uploadsRoot = path.join(projectRoot, 'uploads');

fs.mkdirSync(uploadsRoot, { recursive: true });

const ACCEPTED_UPLOAD_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.xlsx']);
const CONVERTIBLE_UPLOAD_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx']);

function normalizeOwnerId(rawId) {
  const safeId = String(rawId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return safeId || 'anonymous';
}

// Prefer a persistent browser ID from UI, then fall back to express-session.
function ownerId(req) {
  const headerId = req.get('X-Browser-Id');
  const queryId = req.query?.bid;
  const sessionId = req.session?.id;
  return normalizeOwnerId(headerId || queryId || sessionId);
}

function extensionOf(fileName) {
  return path.extname(fileName || '').toLowerCase();
}

function toSafeStoredName(fileName) {
  return String(fileName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'pipe' });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Command failed with exit code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function convertOfficeToPdf(inputPath) {
  const outDir = path.dirname(inputPath);
  const outputPath = path.join(outDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`);
  const commands = ['soffice', 'libreoffice'];
  let lastError = null;

  for (const command of commands) {
    try {
      await runCommand(command, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, inputPath]);
      await fs.promises.access(outputPath, fs.constants.R_OK);
      return outputPath;
    } catch (error) {
      // Try next command if executable not found.
      if (error?.code === 'ENOENT') {
        lastError = error;
        continue;
      }
      lastError = error;
    }
  }

  if (lastError?.code === 'ENOENT') {
    throw new Error('Office-to-PDF conversion requires LibreOffice (soffice). Install with: sudo apt install libreoffice');
  }

  throw new Error(`Failed to convert file to PDF: ${lastError?.message || 'Unknown conversion error'}`);
}

// Returns the user-scoped upload directory, creating it if needed.
function userDir(req) {
  const safeId = ownerId(req);
  const dir = path.join(uploadsRoot, safeId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Multer is configured at request-time so destination is user-scoped.
function makeUpload(req) {
  const storage = multer.diskStorage({
    destination: userDir(req),
    filename: (_, file, cb) => {
      const timestamp = Date.now();
      const safeName = toSafeStoredName(file.originalname);
      cb(null, `${timestamp}-${safeName}`);
    },
  });
  return multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    fileFilter: (_, file, cb) => {
      const ext = extensionOf(file.originalname);
      if (!ACCEPTED_UPLOAD_EXTENSIONS.has(ext)) {
        cb(new Error('Allowed file types: PDF, DOCX, PPTX, XLSX.'));
        return;
      }
      cb(null, true);
    },
  });
}

export function uploadPdfMiddleware(req, res, next) {
  makeUpload(req).single('file')(req, res, (error) => {
    if (!error) { next(); return; }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ status: 'error', message: 'File too large. Maximum is 50MB.' });
      return;
    }
    res.status(400).json({ status: 'error', message: error.message || 'Upload failed.' });
  });
}

export async function handlePdfUpload(req, res) {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'No file uploaded. Use field name "file".' });
  }

  const uploadedExt = extensionOf(req.file.originalname);
  const sourcePath = req.file.path;
  let finalPath = sourcePath;
  let converted = false;

  try {
    if (CONVERTIBLE_UPLOAD_EXTENSIONS.has(uploadedExt)) {
      const convertedPath = await convertOfficeToPdf(sourcePath);
      await fs.promises.unlink(sourcePath).catch(() => {});
      finalPath = convertedPath;
      converted = true;
    }

    const stat = await fs.promises.stat(finalPath);
    const finalName = path.basename(finalPath);
    const displayBaseName = path.basename(req.file.originalname, path.extname(req.file.originalname));
    const displayName = converted ? `${displayBaseName}.pdf` : req.file.originalname;

    res.json({
      status: 'ok',
      file: {
        name: finalName,
        originalName: displayName,
        size: stat.size,
        uploadedAt: new Date().toISOString(),
        converted,
      },
    });
  } catch (error) {
    // Best-effort cleanup for failed conversions/uploads.
    await fs.promises.unlink(sourcePath).catch(() => {});
    if (finalPath !== sourcePath) {
      await fs.promises.unlink(finalPath).catch(() => {});
    }

    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to process uploaded file.',
    });
  }
}

export async function listFiles(req, res) {
  const dir = userDir(req);
  try {
    const entries = await fs.promises.readdir(dir);
    const files = [];

    for (const name of entries) {
      const filePath = path.join(dir, name);
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }

      const dashIdx = name.indexOf('-');
      const originalName = dashIdx !== -1 ? name.slice(dashIdx + 1) : name;
      files.push({
        name,
        originalName,
        size: stat.size,
        uploadedAt: stat.mtime.toISOString(),
      });
    }

    files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    res.json({ status: 'ok', ownerId: ownerId(req), files });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

export async function serveFile(req, res) {
  const dir = userDir(req);
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(dir, safeName);

  // Guard against path traversal
  if (!path.resolve(filePath).startsWith(path.resolve(dir) + path.sep)) {
    return res.status(400).json({ status: 'error', message: 'Invalid filename.' });
  }

  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch {
    return res.status(404).json({ status: 'error', message: 'File not found.' });
  }

  const dashIdx = safeName.indexOf('-');
  const downloadName = dashIdx !== -1 ? safeName.slice(dashIdx + 1) : safeName;
  res.download(filePath, downloadName);
}

export async function deleteFile(req, res) {
  const dir = userDir(req);
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(dir, safeName);

  if (!path.resolve(filePath).startsWith(path.resolve(dir) + path.sep)) {
    return res.status(400).json({ status: 'error', message: 'Invalid filename.' });
  }

  try {
    await fs.promises.unlink(filePath);
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('[files] delete failed', {
      filePath,
      safeName,
      owner: ownerId(req),
      code: error?.code,
      message: error?.message,
    });
    res.status(404).json({ status: 'error', message: 'File not found.' });
  }
}

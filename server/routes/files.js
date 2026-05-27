import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { Builder, parseStringPromise } from 'xml2js';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const uploadsRoot = path.join(projectRoot, 'uploads');

fs.mkdirSync(uploadsRoot, { recursive: true });

const ACCEPTED_UPLOAD_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.csv',
  '.txt',
  '.rtf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
]);
const LOGICAL_FILE_LIMIT_BYTES = 50 * 1024 * 1024;
const RAW_UPLOAD_LIMIT_BYTES = parseInt(process.env.RAW_UPLOAD_MAX_BYTES || String(300 * 1024 * 1024), 10);
const TEXT_SPLITTABLE_EXTENSIONS = new Set(['.txt', '.csv', '.rtf', '.md', '.json']);

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function byteLength(text) {
  return Buffer.byteLength(String(text || ''), 'utf8');
}

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
  return String(fileName || 'file')
    .replace(/[\\/:\*\?"<>\|]/g, '_')
    .replace(/^\s+|\s+$/g, '')
    .slice(0, 255);
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
      if (error?.code === 'ENOENT') {
        lastError = error;
        continue;
      }
      lastError = error;
    }
  }

  if (lastError?.code === 'ENOENT') {
    throw new Error('PPTX preview conversion requires LibreOffice (soffice). Install with: sudo apt install libreoffice');
  }

  throw new Error(`Failed to convert file to PDF: ${lastError?.message || 'Unknown conversion error'}`);
}

function buildSplitStoredName(storedName, partIndex, totalParts) {
  const ext = path.extname(storedName);
  const base = path.basename(storedName, ext);
  return `${base}.part-${String(partIndex).padStart(2, '0')}-of-${String(totalParts).padStart(2, '0')}${ext}`;
}

function buildSplitOriginalName(originalName, partIndex, totalParts) {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  return `${base}.part-${String(partIndex).padStart(2, '0')}-of-${String(totalParts).padStart(2, '0')}${ext}`;
}

function splitStringByByteLimit(text, limitBytes) {
  const parts = [];
  let remaining = String(text || '');

  while (remaining.length > 0) {
    let low = 1;
    let high = remaining.length;
    let best = 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = remaining.slice(0, mid);
      if (byteLength(candidate) <= limitBytes) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    parts.push(remaining.slice(0, best));
    remaining = remaining.slice(best);
  }

  return parts;
}

function splitGenericText(text, limitBytes) {
  const lines = String(text || '').split(/\r?\n/);
  const parts = [];
  let current = '';

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (byteLength(candidate) <= limitBytes) {
      current = candidate;
      continue;
    }

    if (current) {
      parts.push(current);
      current = '';
    }

    if (byteLength(line) <= limitBytes) {
      current = line;
      continue;
    }

    const lineParts = splitStringByByteLimit(line, limitBytes);
    parts.push(...lineParts.slice(0, -1));
    current = lineParts.at(-1) || '';
  }

  if (current || parts.length === 0) {
    parts.push(current);
  }

  return parts.filter((part) => part.length > 0);
}

function splitCsvText(text, limitBytes) {
  const rows = String(text || '').split(/\r?\n/);
  const header = rows[0] || '';
  const dataRows = rows.slice(1).filter((row) => row.length > 0);
  const prefix = header ? `${header}\n` : '';
  const parts = [];
  let currentRows = [];

  if (prefix && byteLength(prefix) > limitBytes) {
    throw new Error(`CSV header exceeds ${formatBytes(limitBytes)} and cannot be split automatically.`);
  }

  for (const row of dataRows) {
    const candidateRows = [...currentRows, row];
    const candidateText = `${prefix}${candidateRows.join('\n')}\n`;
    if (byteLength(candidateText) <= limitBytes) {
      currentRows = candidateRows;
      continue;
    }

    if (currentRows.length > 0) {
      parts.push(`${prefix}${currentRows.join('\n')}\n`);
      currentRows = [];
    }

    const singleRowText = `${prefix}${row}\n`;
    if (byteLength(singleRowText) > limitBytes) {
      throw new Error(`A single CSV row exceeds ${formatBytes(limitBytes)} and cannot be split safely.`);
    }

    currentRows = [row];
  }

  if (currentRows.length > 0 || (parts.length === 0 && prefix)) {
    parts.push(`${prefix}${currentRows.join('\n')}${currentRows.length > 0 ? '\n' : ''}`);
  }

  return parts.filter((part) => part.length > 0);
}

function normalizeZipPath(rawPath) {
  return path.posix.normalize(String(rawPath || '').replace(/\\/g, '/')).replace(/^\.\//, '').replace(/^\/+/, '');
}

function getPartPathFromRelsPath(relsPath) {
  if (relsPath === '_rels/.rels') {
    return '';
  }

  const normalized = normalizeZipPath(relsPath);
  const relsSegment = '/_rels/';
  const idx = normalized.lastIndexOf(relsSegment);
  if (idx === -1 || !normalized.endsWith('.rels')) {
    return null;
  }

  const baseDir = normalized.slice(0, idx);
  const relName = normalized.slice(idx + relsSegment.length).replace(/\.rels$/, '');
  return normalizeZipPath(baseDir ? `${baseDir}/${relName}` : relName);
}

function getRelsPathForPart(partPath) {
  const normalized = normalizeZipPath(partPath);
  if (!normalized) {
    return '_rels/.rels';
  }

  const dir = path.posix.dirname(normalized);
  const base = path.posix.basename(normalized);
  return normalizeZipPath(`${dir === '.' ? '' : `${dir}/`}_rels/${base}.rels`);
}

function resolveRelationshipTarget(sourcePartPath, target) {
  const rawTarget = String(target || '').trim();
  if (!rawTarget || rawTarget.startsWith('#') || /^https?:/i.test(rawTarget)) {
    return null;
  }

  if (rawTarget.startsWith('/')) {
    return normalizeZipPath(rawTarget);
  }

  const sourceDir = sourcePartPath ? path.posix.dirname(sourcePartPath) : '';
  const joined = sourceDir ? path.posix.join(sourceDir, rawTarget) : rawTarget;
  return normalizeZipPath(joined);
}

async function parseXmlFromZip(zip, xmlPath) {
  const file = zip.file(xmlPath);
  if (!file) {
    return null;
  }

  const xml = await file.async('string');
  return parseStringPromise(xml);
}

async function splitPptxBySize(filePath, limitBytes) {
  const sourceBytes = await fs.promises.readFile(filePath);
  const sourceZip = await JSZip.loadAsync(sourceBytes);
  const presentationPath = 'ppt/presentation.xml';
  const presentationRelsPath = 'ppt/_rels/presentation.xml.rels';

  const presentationXml = await parseXmlFromZip(sourceZip, presentationPath);
  const presentationRelsXml = await parseXmlFromZip(sourceZip, presentationRelsPath);

  if (!presentationXml || !presentationRelsXml) {
    throw new Error('PPTX structure missing presentation metadata.');
  }

  const slideIdList = presentationXml?.['p:presentation']?.['p:sldIdLst']?.[0]?.['p:sldId'] || [];
  const relationships = presentationRelsXml?.Relationships?.Relationship || [];
  const relationshipById = new Map(relationships.map((rel) => [rel?.$?.Id, rel]));
  const slideEntries = slideIdList
    .map((slide) => {
      const relId = slide?.$?.['r:id'];
      const rel = relationshipById.get(relId);
      if (!rel) {
        return null;
      }
      return { slide, relId, rel };
    })
    .filter(Boolean);

  if (slideEntries.length === 0) {
    throw new Error('PPTX does not contain any detectable slides.');
  }

  const nonSlideRelationships = relationships.filter((rel) => !/\/slide$/i.test(rel?.$?.Type || ''));
  const xmlBuilder = new Builder();

  async function buildPptxChunk(startSlideIndex, endSlideIndex) {
    const selectedSlides = slideEntries.slice(startSlideIndex, endSlideIndex + 1);
    const selectedSlideRelIds = new Set(selectedSlides.map((entry) => entry.relId));
    const selectedRelationships = relationships.filter((rel) => {
      const relId = rel?.$?.Id;
      if (!relId) {
        return false;
      }
      if (selectedSlideRelIds.has(relId)) {
        return true;
      }
      return nonSlideRelationships.includes(rel);
    });

    const chunkPresentationXml = JSON.parse(JSON.stringify(presentationXml));
    const chunkPresentationRelsXml = JSON.parse(JSON.stringify(presentationRelsXml));
    chunkPresentationXml['p:presentation']['p:sldIdLst'][0]['p:sldId'] = selectedSlides.map((entry) => entry.slide);
    chunkPresentationRelsXml.Relationships.Relationship = selectedRelationships;

    const keepPaths = new Set(['[Content_Types].xml', presentationPath, presentationRelsPath]);
    const queuedParts = [];

    function enqueuePart(partPath) {
      const normalized = normalizeZipPath(partPath);
      if (!normalized || keepPaths.has(normalized)) {
        return;
      }
      if (!sourceZip.file(normalized)) {
        return;
      }
      keepPaths.add(normalized);
      queuedParts.push(normalized);
    }

    async function enqueueRelTargetsFromPart(partPath, relsOverride = null) {
      const relsPath = getRelsPathForPart(partPath);
      if (relsPath && sourceZip.file(relsPath)) {
        keepPaths.add(relsPath);
      }

      const relEntries = relsOverride || (await parseXmlFromZip(sourceZip, relsPath))?.Relationships?.Relationship || [];
      for (const relEntry of relEntries) {
        const target = resolveRelationshipTarget(partPath, relEntry?.$?.Target);
        if (!target) {
          continue;
        }
        enqueuePart(target);
      }
    }

    await enqueueRelTargetsFromPart('', (await parseXmlFromZip(sourceZip, '_rels/.rels'))?.Relationships?.Relationship || []);
    await enqueueRelTargetsFromPart(presentationPath, selectedRelationships);
    selectedSlides.forEach((entry) => {
      const target = resolveRelationshipTarget(presentationPath, entry.rel?.$?.Target);
      if (target) {
        enqueuePart(target);
      }
    });

    while (queuedParts.length > 0) {
      const currentPart = queuedParts.shift();
      await enqueueRelTargetsFromPart(currentPart);
    }

    const newZip = new JSZip();
    const allEntries = Object.values(sourceZip.files);
    for (const entry of allEntries) {
      if (entry.dir) {
        continue;
      }

      const normalizedName = normalizeZipPath(entry.name);
      if (!keepPaths.has(normalizedName)) {
        continue;
      }

      if (normalizedName === presentationPath || normalizedName === presentationRelsPath) {
        continue;
      }

      const content = await entry.async('nodebuffer');
      newZip.file(normalizedName, content);
    }

    newZip.file(presentationPath, xmlBuilder.buildObject(chunkPresentationXml));
    newZip.file(presentationRelsPath, xmlBuilder.buildObject(chunkPresentationRelsXml));

    return newZip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
  }

  const parts = [];
  let startIndex = 0;

  while (startIndex < slideEntries.length) {
    let low = startIndex;
    let high = slideEntries.length - 1;
    let bestChunk = null;
    let bestEndIndex = null;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const chunkBytes = await buildPptxChunk(startIndex, mid);
      if (chunkBytes.length <= limitBytes) {
        bestChunk = chunkBytes;
        bestEndIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (!bestChunk || bestEndIndex === null) {
      throw new Error(`Slide ${startIndex + 1} exceeds ${formatBytes(limitBytes)} and cannot be split smaller automatically.`);
    }

    parts.push(bestChunk);
    startIndex = bestEndIndex + 1;
  }

  return parts;
}

async function splitTextFileBySize(filePath, extension, limitBytes) {
  const text = await fs.promises.readFile(filePath, 'utf8');
  if (extension === '.csv') {
    return splitCsvText(text, limitBytes);
  }
  return splitGenericText(text, limitBytes);
}

async function buildPdfChunk(sourceDoc, startIndex, endIndex) {
  const chunkDoc = await PDFDocument.create();
  const indices = Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => startIndex + offset);
  const copiedPages = await chunkDoc.copyPages(sourceDoc, indices);
  copiedPages.forEach((page) => chunkDoc.addPage(page));
  return chunkDoc.save();
}

async function splitPdfBySize(filePath, limitBytes) {
  const sourceBytes = await fs.promises.readFile(filePath);
  const sourceDoc = await PDFDocument.load(sourceBytes);
  const totalPages = sourceDoc.getPageCount();
  const parts = [];
  let startIndex = 0;

  while (startIndex < totalPages) {
    let bestBytes = null;
    let bestEndIndex = null;

    for (let endIndex = startIndex; endIndex < totalPages; endIndex += 1) {
      const candidateBytes = await buildPdfChunk(sourceDoc, startIndex, endIndex);
      if (candidateBytes.length <= limitBytes) {
        bestBytes = candidateBytes;
        bestEndIndex = endIndex;
        continue;
      }

      if (endIndex === startIndex) {
        throw new Error(`PDF page ${startIndex + 1} exceeds ${formatBytes(limitBytes)} and cannot be split smaller automatically.`);
      }
      break;
    }

    if (!bestBytes || bestEndIndex === null) {
      throw new Error('Failed to split PDF into parts under the configured size limit.');
    }

    parts.push(bestBytes);
    startIndex = bestEndIndex + 1;
  }

  return parts;
}

async function writeSplitParts({ uploadedPath, storedName, originalName, extension, dir }) {
  let chunks;
  if (extension === '.pdf') {
    chunks = await splitPdfBySize(uploadedPath, LOGICAL_FILE_LIMIT_BYTES);
  } else if (extension === '.pptx') {
    chunks = await splitPptxBySize(uploadedPath, LOGICAL_FILE_LIMIT_BYTES);
  } else {
    chunks = await splitTextFileBySize(uploadedPath, extension, LOGICAL_FILE_LIMIT_BYTES);
  }

  const files = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const partStoredName = buildSplitStoredName(storedName, index + 1, chunks.length);
    const partPath = path.join(dir, partStoredName);
    const chunk = chunks[index];
    if (typeof chunk === 'string') {
      await fs.promises.writeFile(partPath, chunk, 'utf8');
    } else {
      await fs.promises.writeFile(partPath, chunk);
    }

    const stat = await fs.promises.stat(partPath);
    files.push({
      name: partStoredName,
      originalName: buildSplitOriginalName(originalName, index + 1, chunks.length),
      size: stat.size,
      uploadedAt: new Date().toISOString(),
      converted: false,
    });
  }

  await fs.promises.unlink(uploadedPath).catch(() => {});
  return files;
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
    limits: { fileSize: RAW_UPLOAD_LIMIT_BYTES }, // allows server-side splitting before enforcing logical 50 MB storage limit
    fileFilter: (_, file, cb) => {
      const ext = extensionOf(file.originalname);
      if (!ACCEPTED_UPLOAD_EXTENSIONS.has(ext)) {
        cb(new Error('Allowed file types: PDF, DOCX, PPTX, XLSX, CSV, TXT, RTF, PNG, JPG, JPEG, GIF, WEBP.'));
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
      res.status(413).json({ status: 'error', message: `File too large for server-side splitting. Maximum raw upload is ${formatBytes(RAW_UPLOAD_LIMIT_BYTES)}.` });
      return;
    }
    res.status(400).json({ status: 'error', message: error.message || 'Upload failed.' });
  });
}

export async function handlePdfUpload(req, res) {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'No file uploaded. Use field name "file".' });
  }

  const uploadedPath = req.file.path;
  const uploadedExt = extensionOf(req.file.originalname);

  try {
    const stat = await fs.promises.stat(uploadedPath);
    const finalName = path.basename(uploadedPath);

    if (stat.size > LOGICAL_FILE_LIMIT_BYTES) {
      if (uploadedExt !== '.pdf' && uploadedExt !== '.pptx' && !TEXT_SPLITTABLE_EXTENSIONS.has(uploadedExt)) {
        await fs.promises.unlink(uploadedPath).catch(() => {});
        return res.status(413).json({
          status: 'error',
          message: `Files larger than 50MB must be PDF, PPTX, or text-like formats for automatic splitting. Received ${uploadedExt || 'unknown type'}.`,
        });
      }

      const splitFiles = await writeSplitParts({
        uploadedPath,
        storedName: finalName,
        originalName: req.file.originalname,
        extension: uploadedExt,
        dir: path.dirname(uploadedPath),
      });

      return res.json({
        status: 'ok',
        split: true,
        message: `Uploaded file exceeded 50MB and was split into ${splitFiles.length} parts.`,
        files: splitFiles,
      });
    }

    res.json({
      status: 'ok',
      file: {
        name: finalName,
        originalName: req.file.originalname,
        size: stat.size,
        uploadedAt: new Date().toISOString(),
        converted: false,
      },
    });
  } catch (error) {
    await fs.promises.unlink(uploadedPath).catch(() => {});

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
  if (String(req.query?.preview || '').toLowerCase() === '1') {
    res.type(downloadName);
    res.setHeader('Content-Disposition', `inline; filename="${downloadName.replace(/"/g, '')}"`);
    res.sendFile(path.resolve(filePath));
    return;
  }

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

export async function convertFileToPreviewPdf(req, res) {
  const dir = userDir(req);
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(dir, safeName);

  if (!path.resolve(filePath).startsWith(path.resolve(dir) + path.sep)) {
    return res.status(400).json({ status: 'error', message: 'Invalid filename.' });
  }

  if (extensionOf(safeName) !== '.pptx') {
    return res.status(400).json({ status: 'error', message: 'Only PPTX conversion-to-preview is supported by this endpoint.' });
  }

  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch {
    return res.status(404).json({ status: 'error', message: 'File not found.' });
  }

  try {
    const convertedPath = await convertOfficeToPdf(filePath);
    const convertedName = path.basename(convertedPath);
    const stat = await fs.promises.stat(convertedPath);

    res.json({
      status: 'ok',
      file: {
        name: convertedName,
        originalName: `${path.basename(safeName, '.pptx')}.pdf`,
        size: stat.size,
        uploadedAt: stat.mtime.toISOString(),
        convertedFrom: safeName,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to convert PPTX to PDF for preview.',
    });
  }
}

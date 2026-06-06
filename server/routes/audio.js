import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import { postProcessTranscript } from '../utils/transcript-postprocessor.js';

const tempUploadDir = path.join(os.tmpdir(), 'snowfox-audio-uploads');
fs.mkdirSync(tempUploadDir, { recursive: true });

const ACCEPTED_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav']);
const RAW_AUDIO_UPLOAD_LIMIT_BYTES = parseInt(process.env.AUDIO_UPLOAD_MAX_BYTES || String(80 * 1024 * 1024), 10);
const WHISPER_API_BASE_URL = (process.env.WHISPER_API_BASE_URL || 'http://127.0.0.1:9000').trim().replace(/\/+$/, '');
const WHISPER_TIMEOUT_MS = parseInt(process.env.WHISPER_TIMEOUT_MS || String(10 * 60 * 1000), 10);
const AUDIO_TRANSCRIBE_DEBUG = ['1', 'true', 'yes', 'on'].includes(String(process.env.AUDIO_TRANSCRIBE_DEBUG || '').toLowerCase());
const AUDIO_KEEP_TEMP_UPLOADS = ['1', 'true', 'yes', 'on'].includes(String(process.env.AUDIO_KEEP_TEMP_UPLOADS || '').toLowerCase());
const multipartDebugDir = path.join(tempUploadDir, 'multipart-debug');

if (AUDIO_TRANSCRIBE_DEBUG) {
  fs.mkdirSync(multipartDebugDir, { recursive: true });
}

function describeFetchCause(error) {
  const cause = error?.cause;
  if (!cause || typeof cause !== 'object') {
    return null;
  }

  return {
    name: cause.name || null,
    code: cause.code || null,
    message: cause.message || null,
    errno: cause.errno || null,
    syscall: cause.syscall || null,
    address: cause.address || null,
    port: cause.port || null,
  };
}

function isDetachedArrayBufferFetchError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = String(error.message || '');
  const causeMessage = typeof error.cause?.message === 'string' ? error.cause.message : '';
  return /detached ArrayBuffer/i.test(message) || /detached ArrayBuffer/i.test(causeMessage);
}

function shouldForceHttpsForWhisperBase(baseUrl) {
  if (!baseUrl.startsWith('http://')) {
    return false;
  }

  return !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseUrl);
}

function buildWhisperRequestUrl(endpointPath) {
  if (shouldForceHttpsForWhisperBase(WHISPER_API_BASE_URL)) {
    return `${WHISPER_API_BASE_URL.replace(/^http:\/\//i, 'https://')}${endpointPath}`;
  }

  return `${WHISPER_API_BASE_URL}${endpointPath}`;
}

function sanitizeMultipartFilename(fileName) {
  return String(fileName || 'audio.wav')
    .replace(/[\r\n"]/g, '_')
    .trim() || 'audio.wav';
}

function contentTypeForAudio(fileName, mimeType) {
  if (typeof mimeType === 'string' && mimeType.trim()) {
    return mimeType;
  }

  const ext = extensionOf(fileName);
  if (ext === '.mp3') {
    return 'audio/mpeg';
  }
  if (ext === '.wav') {
    return 'audio/wav';
  }
  return 'application/octet-stream';
}

async function callWhisperMultipart({ requestId, uploadedPath, originalName, mimeType, endpointPath }) {
  const audioBuffer = await fs.promises.readFile(uploadedPath);
  const safeFileName = sanitizeMultipartFilename(originalName);
  const safeMimeType = contentTypeForAudio(safeFileName, mimeType);
  const boundary = `----memorybook-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  const multipartStart = Buffer.from(
    `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="audio_file"; filename="${safeFileName}"\r\n`
      + `Content-Type: ${safeMimeType}\r\n\r\n`,
    'utf8'
  );
  const multipartEnd = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const multipartBody = Buffer.concat([multipartStart, audioBuffer, multipartEnd]);
  const requestUrl = buildWhisperRequestUrl(endpointPath);

  if (AUDIO_TRANSCRIBE_DEBUG) {
    const runtimeTmpDir = os.tmpdir();
    console.log('[audio] multipart debug directories', {
      requestId,
      endpointPath,
      osTmpDir: runtimeTmpDir,
      tempUploadDir,
      multipartDebugDir,
    });

    const endpointLabel = String(endpointPath || 'unknown').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'unknown';
    const dumpName = `${Date.now()}-${requestId}-${endpointLabel}.multipart.bin`;
    const dumpPath = path.join(multipartDebugDir, dumpName);
    await fs.promises.writeFile(dumpPath, multipartBody);
    console.log('[audio] multipart payload dumped', {
      requestId,
      endpointPath,
      path: dumpPath,
      payloadBytes: multipartBody.length,
      boundary,
    });
  }

  const sendMultipart = (url) => fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(multipartBody.length),
    },
    // Use a fresh Buffer each attempt to avoid detached ArrayBuffer reuse in undici.
    body: Buffer.from(multipartBody),
    signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
  });

  let whisperResponse = null;
  let fetchError = null;

  try {
    whisperResponse = await sendMultipart(requestUrl);
  } catch (error) {
    fetchError = error;

    if (isDetachedArrayBufferFetchError(error)) {
      console.error('[audio] detached ArrayBuffer fetch error encountered on normalized whisper url', {
        requestId,
        endpointPath,
        requestUrl,
      });
    }
  }

  if (!whisperResponse) {
    const cause = describeFetchCause(fetchError);
    console.error('[audio] whisper fetch failed', {
      requestId,
      endpointPath,
      whisperBaseUrl: WHISPER_API_BASE_URL,
      timeoutMs: WHISPER_TIMEOUT_MS,
      fileName: safeFileName,
      mimeType: safeMimeType,
      payloadBytes: multipartBody.length,
      message: fetchError instanceof Error ? fetchError.message : String(fetchError || 'Unknown fetch error'),
      cause,
    });

    const detail = cause?.code
      ? `${cause.code}${cause.message ? `: ${cause.message}` : ''}`
      : (fetchError instanceof Error ? fetchError.message : String(fetchError || 'Unknown fetch error'));

    throw new Error(`Cannot reach Whisper upstream (${requestUrl}). ${detail}`);
  }

  const raw = await whisperResponse.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }

  console.log('[audio] whisper response received', {
    requestId,
    endpointPath,
    status: whisperResponse.status,
    ok: whisperResponse.ok,
    payloadBytes: multipartBody.length,
    contentType: whisperResponse.headers.get('content-type') || null,
    bodyLength: raw.length,
  });

  if (!whisperResponse.ok && AUDIO_TRANSCRIBE_DEBUG) {
    console.log('[audio] whisper non-200 response preview', {
      requestId,
      endpointPath,
      bodyPreview: raw.slice(0, 1200),
    });
  }

  return { whisperResponse, raw, json };
}

function extensionOf(fileName) {
  return path.extname(fileName || '').toLowerCase();
}

function shouldRetainUploadedFile(file) {
  if (!AUDIO_KEEP_TEMP_UPLOADS) {
    return false;
  }

  return extensionOf(file?.originalname) === '.wav';
}

const uploadAudio = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tempUploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${file.originalname}`),
  }),
  limits: { fileSize: RAW_AUDIO_UPLOAD_LIMIT_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = extensionOf(file.originalname);
    if (!ACCEPTED_AUDIO_EXTENSIONS.has(ext)) {
      cb(new Error('Unsupported audio format. Only MP3 and WAV are allowed.'));
      return;
    }
    cb(null, true);
  },
});

export function uploadAudioMiddleware(req, res, next) {
  uploadAudio.single('audio')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      console.warn('[audio] upload rejected: file too large', {
        limitBytes: RAW_AUDIO_UPLOAD_LIMIT_BYTES,
      });
      res.status(413).json({
        status: 'error',
        message: `Audio file too large. Maximum upload is ${Math.round(RAW_AUDIO_UPLOAD_LIMIT_BYTES / (1024 * 1024))} MB.`,
      });
      return;
    }

    console.warn('[audio] upload rejected', {
      message: error.message,
      code: error.code || null,
      field: error.field || null,
    });

    res.status(400).json({
      status: 'error',
      message: error.message || 'Audio upload failed.',
    });
  });
}

export async function transcribeAudio(req, res) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  if (!req.file?.path) {
    console.warn('[audio] missing uploaded file', { requestId });
    res.status(400).json({
      status: 'error',
      message: 'No audio uploaded. Use field name "audio".',
    });
    return;
  }

  try {
    console.log('[audio] transcribe request started', {
      requestId,
      fileName: req.file.originalname,
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype,
      whisperBaseUrl: WHISPER_API_BASE_URL,
      timeoutMs: WHISPER_TIMEOUT_MS,
    });

    const {
      whisperResponse,
      raw,
      json,
    } = await callWhisperMultipart({
      requestId,
      uploadedPath: req.file.path,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      endpointPath: '/asr?task=transcribe&output=json',
    });

    if (!whisperResponse.ok) {
      const isCloudflare413 = whisperResponse.status === 413 && /cdn-cgi|cloudflare|request entity too large/i.test(raw);
      const message = isCloudflare413
        ? 'Whisper upstream rejected the upload at the edge (Cloudflare 413). Set the whisper DNS record to DNS-only or call the whisper origin directly from this server.'
        : (json?.detail || json?.message || raw || `Whisper request failed with status ${whisperResponse.status}.`);
      console.warn('[audio] transcription failed upstream', {
        requestId,
        status: whisperResponse.status,
        cloudflare413: isCloudflare413,
        message: String(message).slice(0, 240),
      });
      res.status(whisperResponse.status).json({
        status: 'error',
        message: String(message).slice(0, 500),
      });
      return;
    }

    const postProcessed = postProcessTranscript({
      text: typeof json?.text === 'string' ? json.text : '',
      segments: Array.isArray(json?.segments) ? json.segments : [],
    });

    res.json({
      status: 'success',
      text: postProcessed.text,
      segments: postProcessed.segments,
      language: json?.language || null,
      postProcess: {
        enabled: postProcessed.enabled,
        glossarySize: postProcessed.glossarySize,
        corrections: postProcessed.corrections,
      },
      file: {
        originalName: req.file.originalname,
        size: req.file.size,
      },
    });

    console.log('[audio] transcription completed', {
      requestId,
      elapsedMs: Date.now() - startedAt,
      language: json?.language || null,
      textLength: postProcessed.text.length,
      segments: postProcessed.segments.length,
      postProcessCorrections: postProcessed.corrections.length,
      postProcessGlossarySize: postProcessed.glossarySize,
    });

    if (!String(postProcessed.text || '').trim()) {
      console.warn('[audio] empty transcript returned', {
        requestId,
        fileName: req.file.originalname,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Audio transcription failed.';
    console.error('[audio] transcription request crashed', {
      requestId,
      elapsedMs: Date.now() - startedAt,
      message,
      stack: error instanceof Error ? error.stack : null,
    });
    res.status(500).json({
      status: 'error',
      message,
    });
  } finally {
    if (req.file?.path) {
      const retainUpload = shouldRetainUploadedFile(req.file);

      if (retainUpload) {
        console.log('[audio] temp wav upload retained', {
          requestId,
          path: req.file.path,
          originalName: req.file.originalname,
        });
      } else {
        await fs.promises.unlink(req.file.path).catch(() => {});
        if (AUDIO_TRANSCRIBE_DEBUG) {
          console.log('[audio] temp upload cleaned up', {
            requestId,
            path: req.file.path,
          });
        }
      }
    }
  }
}

export async function detectAudioLanguage(req, res) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  if (!req.file?.path) {
    console.warn('[audio] missing uploaded file for language detection', { requestId });
    res.status(400).json({
      status: 'error',
      message: 'No audio uploaded. Use field name "audio".',
    });
    return;
  }

  try {
    console.log('[audio] language-detect request started', {
      requestId,
      fileName: req.file.originalname,
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype,
      whisperBaseUrl: WHISPER_API_BASE_URL,
      timeoutMs: WHISPER_TIMEOUT_MS,
    });

    const {
      whisperResponse,
      raw,
      json,
    } = await callWhisperMultipart({
      requestId,
      uploadedPath: req.file.path,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      endpointPath: '/detect_language',
    });

    if (!whisperResponse.ok) {
      const isCloudflare413 = whisperResponse.status === 413 && /cdn-cgi|cloudflare|request entity too large/i.test(raw);
      const message = isCloudflare413
        ? 'Whisper upstream rejected the upload at the edge (Cloudflare 413). Set the whisper DNS record to DNS-only or call the whisper origin directly from this server.'
        : (json?.detail || json?.message || raw || `Whisper request failed with status ${whisperResponse.status}.`);
      console.warn('[audio] language detection failed upstream', {
        requestId,
        status: whisperResponse.status,
        cloudflare413: isCloudflare413,
        message: String(message).slice(0, 240),
      });
      res.status(whisperResponse.status).json({
        status: 'error',
        message: String(message).slice(0, 500),
      });
      return;
    }

    res.json({
      status: 'success',
      language: json?.language || json?.lang || null,
      confidence: Number.isFinite(json?.confidence) ? json.confidence : (Number.isFinite(json?.probability) ? json.probability : null),
      raw: json || null,
      file: {
        originalName: req.file.originalname,
        size: req.file.size,
      },
    });

    console.log('[audio] language-detect completed', {
      requestId,
      elapsedMs: Date.now() - startedAt,
      language: json?.language || json?.lang || null,
      confidence: Number.isFinite(json?.confidence) ? json.confidence : (Number.isFinite(json?.probability) ? json.probability : null),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Audio language detection failed.';
    console.error('[audio] language-detect request crashed', {
      requestId,
      elapsedMs: Date.now() - startedAt,
      message,
      stack: error instanceof Error ? error.stack : null,
    });
    res.status(500).json({
      status: 'error',
      message,
    });
  } finally {
    if (req.file?.path) {
      const retainUpload = shouldRetainUploadedFile(req.file);

      if (retainUpload) {
        console.log('[audio] temp wav upload retained', {
          requestId,
          path: req.file.path,
          originalName: req.file.originalname,
        });
      } else {
        await fs.promises.unlink(req.file.path).catch(() => {});
        if (AUDIO_TRANSCRIBE_DEBUG) {
          console.log('[audio] temp upload cleaned up', {
            requestId,
            path: req.file.path,
          });
        }
      }
    }
  }
}
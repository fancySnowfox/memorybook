import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';

const tempUploadDir = path.join(os.tmpdir(), 'snowfox-audio-uploads');
fs.mkdirSync(tempUploadDir, { recursive: true });

const ACCEPTED_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav']);
const RAW_AUDIO_UPLOAD_LIMIT_BYTES = parseInt(process.env.AUDIO_UPLOAD_MAX_BYTES || String(80 * 1024 * 1024), 10);
const WHISPER_API_BASE_URL = (process.env.WHISPER_API_BASE_URL || 'http://127.0.0.1:9000').trim().replace(/\/+$/, '');
const WHISPER_TIMEOUT_MS = parseInt(process.env.WHISPER_TIMEOUT_MS || String(10 * 60 * 1000), 10);

function extensionOf(fileName) {
  return path.extname(fileName || '').toLowerCase();
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
      res.status(413).json({
        status: 'error',
        message: `Audio file too large. Maximum upload is ${Math.round(RAW_AUDIO_UPLOAD_LIMIT_BYTES / (1024 * 1024))} MB.`,
      });
      return;
    }

    res.status(400).json({
      status: 'error',
      message: error.message || 'Audio upload failed.',
    });
  });
}

export async function transcribeAudio(req, res) {
  if (!req.file?.path) {
    res.status(400).json({
      status: 'error',
      message: 'No audio uploaded. Use field name "audio".',
    });
    return;
  }

  try {
    const audioBuffer = await fs.promises.readFile(req.file.path);
    const formData = new FormData();
    formData.append('audio_file', new Blob([audioBuffer]), req.file.originalname || 'audio.wav');

    const whisperResponse = await fetch(`${WHISPER_API_BASE_URL}/asr?task=transcribe&output=json`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
    });

    const raw = await whisperResponse.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }

    if (!whisperResponse.ok) {
      const message = json?.detail || json?.message || raw || `Whisper request failed with status ${whisperResponse.status}.`;
      res.status(whisperResponse.status).json({
        status: 'error',
        message: String(message).slice(0, 500),
      });
      return;
    }

    res.json({
      status: 'success',
      text: typeof json?.text === 'string' ? json.text : '',
      segments: Array.isArray(json?.segments) ? json.segments : [],
      language: json?.language || null,
      file: {
        originalName: req.file.originalname,
        size: req.file.size,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Audio transcription failed.';
    res.status(500).json({
      status: 'error',
      message,
    });
  } finally {
    await fs.promises.unlink(req.file.path).catch(() => {});
  }
}
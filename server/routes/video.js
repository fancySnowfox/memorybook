import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const converterScriptPath = path.join(projectRoot, 'server', 'scripts', 'convert-mov-to-mp4.js');

const uploadDir = path.join(os.tmpdir(), 'snowfox-video-uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 1024 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (!/\.mov$/i.test(file.originalname || '')) {
      cb(new Error('Only .MOV files are allowed.'));
      return;
    }
    cb(null, true);
  },
});

function runNodeScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      reject(new Error(`Converter failed to start: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Converter exited with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
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

function uploadMovMiddleware(req, res, next) {
  upload.single('video')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          status: 'error',
          message: 'Uploaded file is too large. Maximum allowed is 1GB.',
        });
        return;
      }

      res.status(400).json({
        status: 'error',
        message: `Upload failed: ${error.message}`,
      });
      return;
    }

    res.status(400).json({
      status: 'error',
      message: error.message || 'Invalid upload request.',
    });
  });
}

async function convertMovToMp4(req, res) {
  const tempWorkDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'snowfox-video-work-'));

  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No video file uploaded. Use field name "video".',
      });
    }

    const originalName = req.file.originalname || 'video.MOV';
    const inputPath = path.join(tempWorkDir, 'input.mov');
    const outputPath = path.join(tempWorkDir, 'output.mp4');

    const requestedWidthRaw = req.body?.maxWidth;
    const requestedWidth = requestedWidthRaw ? Number(requestedWidthRaw) : null;
    if (requestedWidthRaw && (!Number.isInteger(requestedWidth) || requestedWidth < 320)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid resolution option. Expected width >= 320.',
      });
    }

    await fs.promises.rename(req.file.path, inputPath);

    const converterArgs = [
      inputPath,
      outputPath,
      '--max-mb=10',
    ];

    if (requestedWidth) {
      converterArgs.push(`--max-width=${requestedWidth}`);
    }

    await runNodeScript(converterScriptPath, [
      ...converterArgs,
    ]);

    const outputStats = await fs.promises.stat(outputPath);
    const outputSizeMb = outputStats.size / (1024 * 1024);
    const downloadName = `${path.basename(originalName, path.extname(originalName))}.mp4`;

    res.setHeader('X-Output-Size-MB', outputSizeMb.toFixed(2));

    res.download(outputPath, downloadName, async (downloadError) => {
      if (downloadError && !res.headersSent) {
        res.status(500).json({
          status: 'error',
          message: downloadError.message,
        });
      }

      await removeDirSafe(tempWorkDir);
    });
  } catch (error) {
    console.error('Video conversion error:', error);

    if (!res.headersSent) {
      res.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Video conversion failed',
      });
    }

    await removeDirSafe(tempWorkDir);
  }
}

export { uploadMovMiddleware, convertMovToMp4 };

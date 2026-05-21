import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROJECT_FFMPEG_CANDIDATES = [
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
  './ffmpeg',
  '../FFmpeg/ffmpeg',
];

function printUsage() {
  console.log(`Usage:
  node server/scripts/convert-mov-to-mp4.js <input.mov> [output.mp4] [--max-mb=10] [--max-width=1280]

Examples:
  node server/scripts/convert-mov-to-mp4.js ./videos/input.MOV
  node server/scripts/convert-mov-to-mp4.js ./videos/input.MOV ./videos/output.mp4 --max-mb=10 --max-width=1280
`);
}

function parseArgs(argv) {
  const options = {
    maxMb: 10,
    maxWidth: null,
  };

  const positional = [];

  for (const arg of argv) {
    if (arg.startsWith('--max-mb=')) {
      const parsed = Number(arg.split('=')[1]);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('Invalid --max-mb value. Use a positive number.');
      }
      options.maxMb = parsed;
      continue;
    }

    if (arg.startsWith('--max-width=')) {
      const parsed = Number(arg.split('=')[1]);
      if (!Number.isInteger(parsed) || parsed < 320) {
        throw new Error('Invalid --max-width value. Use an integer >= 320.');
      }
      options.maxWidth = parsed;
      continue;
    }

    positional.push(arg);
  }

  if (positional.length < 1) {
    throw new Error('Missing input file path.');
  }

  const inputPath = path.resolve(positional[0]);
  const outputPath = positional[1]
    ? path.resolve(positional[1])
    : path.resolve(
        path.dirname(inputPath),
        `${path.basename(inputPath, path.extname(inputPath))}.h264.mp4`
      );

  return { inputPath, outputPath, options };
}

function runCommand(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', (error) => {
      reject(new Error(`${label} failed to start: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const details = (stderr || stdout || '').trim();
        reject(new Error(`${label} failed with exit code ${code}${details ? `\n${details}` : ''}`));
        return;
      }
      resolve();
    });
  });
}

async function resolveFfmpegCommand() {
  for (const candidate of PROJECT_FFMPEG_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      await runCommand(candidate, ['-version'], 'ffmpeg check');
      return candidate;
    }
  }

  await runCommand('ffmpeg', ['-version'], 'ffmpeg check');
  return 'ffmpeg';
}

function bytesToMb(bytes) {
  return bytes / (1024 * 1024);
}

async function ensureFfmpegAvailable() {
  try {
    const command = await resolveFfmpegCommand();
    return command;
  } catch (error) {
    throw new Error(
      'FFmpeg is required but was not found. Install it with: sudo apt install ffmpeg'
    );
  }
}

async function commandOutput(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, stdout, stderr, code });
        return;
      }
      resolve({ ok: true, stdout, stderr, code });
    });
  });
}

async function detectEncodingMode(ffmpegCommand) {
  const encoders = await commandOutput(ffmpegCommand, ['-hide_banner', '-encoders']);
  const supportsLibx264 = encoders.ok && /\blibx264\b/.test(`${encoders.stdout}\n${encoders.stderr}`);
  if (supportsLibx264) {
    return 'crf';
  }
  return 'bitrate';
}

async function main() {
  try {
    const { inputPath, outputPath, options } = parseArgs(process.argv.slice(2));

    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }

    if (!/\.mov$/i.test(inputPath)) {
      console.warn('Input extension is not .MOV. Continuing anyway.');
    }

    const ffmpegCommand = await ensureFfmpegAvailable();
    const encodingMode = await detectEncodingMode(ffmpegCommand);
    if (encodingMode === 'bitrate') {
      console.warn('libx264 or CRF mode unavailable. Falling back to bitrate-based encoding.');
    }

    const maxBytes = options.maxMb * 1024 * 1024;
    const attempts = [
      { crf: 23, width: 1920, audioKbps: 128 },
      { crf: 26, width: 1280, audioKbps: 96 },
      { crf: 29, width: 960, audioKbps: 64 },
      { crf: 32, width: 720, audioKbps: 48 },
      { crf: 35, width: 640, audioKbps: 32 },
      { crf: 38, width: 480, audioKbps: 32 },
    ].map((attempt) => {
      if (!options.maxWidth) {
        return attempt;
      }

      return {
        ...attempt,
        width: Math.min(attempt.width, options.maxWidth),
      };
    });

    const tempOutputPath = `${outputPath}.tmp.mp4`;
    let success = false;

    for (let i = 0; i < attempts.length; i += 1) {
      const attempt = attempts[i];
      console.log(
        `\nAttempt ${i + 1}/${attempts.length}: CRF ${attempt.crf}, max width ${attempt.width}, audio ${attempt.audioKbps}k`
      );

      if (fs.existsSync(tempOutputPath)) {
        fs.unlinkSync(tempOutputPath);
      }

      const videoFilter = `scale=min(${attempt.width}\\,iw):-2`;
      const ffmpegArgs = [
        '-y',
        '-i',
        inputPath,
        '-vf',
        videoFilter,
      ];

      if (encodingMode === 'crf') {
        ffmpegArgs.push(
          '-c:v',
          'libx264',
          '-crf',
          String(attempt.crf),
          '-pix_fmt',
          'yuv420p',
          '-profile:v',
          'high',
          '-level',
          '4.1'
        );
      } else {
        const fallbackVideoBitrateKbps = [2200, 1600, 1100, 800, 600, 450][i] || 450;
        ffmpegArgs.push(
          '-c:v',
          'mpeg4',
          '-b:v',
          `${fallbackVideoBitrateKbps}k`,
          '-pix_fmt',
          'yuv420p'
        );
      }

      ffmpegArgs.push(
        '-c:a',
        'aac',
        '-b:a',
        `${attempt.audioKbps}k`,
        '-movflags',
        '+faststart',
        tempOutputPath,
      );

      await runCommand(ffmpegCommand, ffmpegArgs, 'ffmpeg encode');

      const sizeBytes = fs.statSync(tempOutputPath).size;
      const sizeMb = bytesToMb(sizeBytes);
      console.log(`Output size: ${sizeMb.toFixed(2)} MB (target <= ${options.maxMb} MB)`);

      if (sizeBytes <= maxBytes) {
        success = true;
        break;
      }
    }

    if (!success) {
      throw new Error(
        `Could not reach <= ${options.maxMb} MB. The source may be too long for this size target while keeping playable quality.`
      );
    }

    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    fs.renameSync(tempOutputPath, outputPath);
    const finalSizeMb = bytesToMb(fs.statSync(outputPath).size);
    console.log(`\nDone: ${outputPath}`);
    console.log(`Final size: ${finalSizeMb.toFixed(2)} MB`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
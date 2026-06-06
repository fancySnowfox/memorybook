import fs from 'node:fs/promises';
import path from 'node:path';
import { collapseMedicalTerms, extractMedicalTermsFromDocument } from '../utils/pptx-medical-glossary.js';

function parseArgs(argv) {
  const args = {
    inputFiles: [],
    outputFile: path.resolve(process.cwd(), 'server', 'data', 'medical-glossary.json'),
    slideNumbers: [],
  };

  for (const token of argv) {
    if (token.startsWith('--out=')) {
      args.outputFile = path.resolve(process.cwd(), token.slice('--out='.length));
      continue;
    }

    if (token.startsWith('--slides=')) {
      const parsedSlides = token
        .slice('--slides='.length)
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isInteger(value) && value > 0);
      args.slideNumbers = parsedSlides;
      continue;
    }

    if (token.trim()) {
      args.inputFiles.push(path.resolve(process.cwd(), token));
    }
  }

  return args;
}

async function ensureParentDir(filePath) {
  const parentDir = path.dirname(filePath);
  await fs.mkdir(parentDir, { recursive: true });
}

async function main() {
  const { inputFiles, outputFile, slideNumbers } = parseArgs(process.argv.slice(2));

  if (!inputFiles.length) {
    console.error('Usage: node server/scripts/build-medical-glossary-from-pptx.js <file.pdf|file.pptx> [more files] [--slides=1,2] [--out=server/data/medical-glossary.json]');
    process.exitCode = 1;
    return;
  }

  const allLists = [];

  for (const inputFile of inputFiles) {
    const terms = await extractMedicalTermsFromDocument({
      filePath: inputFile,
      slideNumbers,
    });

    allLists.push(terms);
    console.log('[glossary] extracted', {
      inputFile,
      terms: terms.length,
      slideFilter: slideNumbers,
    });
  }

  const merged = collapseMedicalTerms(allLists);
  await ensureParentDir(outputFile);
  await fs.writeFile(outputFile, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

  console.log('[glossary] written', {
    outputFile,
    terms: merged.length,
  });
}

main().catch((error) => {
  console.error('[glossary] failed', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { PDFParse } from 'pdf-parse';
import { parseStringPromise } from 'xml2js';

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function canonicalKey(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function splitCandidateTerms(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/[;|,\u2022\u2023\u25E6\u2043\u2219]/g)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean)
    .map((part) => part.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean);
}

function collectTermsFromRawText(text) {
  const lines = String(text || '')
    .split(/\r?\n/g)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const collected = [];
  for (const line of lines) {
    const candidates = splitCandidateTerms(line);
    for (const candidate of candidates) {
      if (looksLikeMedicalTerm(candidate)) {
        collected.push(candidate);
      }
    }
  }

  return collected;
}

function looksLikeMedicalTerm(value) {
  const term = normalizeWhitespace(value);
  if (term.length < 3 || term.length > 90) {
    return false;
  }

  if (!/[a-zA-Z]/.test(term)) {
    return false;
  }

  if (/^[\W_]+$/.test(term)) {
    return false;
  }

  return true;
}

function collectParagraphTextsFromSlideXml(parsed) {
  const paragraphs = [];
  const slideShapes = parsed?.['p:sld']?.['p:cSld']?.[0]?.['p:spTree']?.[0]?.['p:sp'] || [];
  const shapeArray = Array.isArray(slideShapes) ? slideShapes : [slideShapes];

  for (const shape of shapeArray) {
    const paragraphNodes = shape?.['p:txBody']?.[0]?.['a:p'] || [];
    const paragraphArray = Array.isArray(paragraphNodes) ? paragraphNodes : [paragraphNodes];

    for (const paragraph of paragraphArray) {
      const runs = paragraph?.['a:r'] || [];
      const runArray = Array.isArray(runs) ? runs : [runs];
      const pieces = [];

      for (const run of runArray) {
        const runText = run?.['a:t']?.[0];
        if (runText) {
          pieces.push(String(runText));
        }
      }

      const paragraphText = normalizeWhitespace(pieces.join(' '));
      if (paragraphText) {
        paragraphs.push(paragraphText);
      }
    }
  }

  return paragraphs;
}

function extractSlideNumberFromPath(entryPath) {
  const match = entryPath.match(/^ppt\/slides\/slide(\d+)\.xml$/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function collapseMedicalTerms(termLists) {
  const byKey = new Map();
  for (const list of termLists) {
    for (const term of list || []) {
      if (!looksLikeMedicalTerm(term)) {
        continue;
      }

      const normalized = normalizeWhitespace(term);
      const key = canonicalKey(normalized);
      if (!byKey.has(key)) {
        byKey.set(key, normalized);
      }
    }
  }

  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
}

export async function extractMedicalTermsFromPptx({ filePath, slideNumbers = [] }) {
  const bytes = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(bytes);

  const selectedSlides = new Set(
    (Array.isArray(slideNumbers) ? slideNumbers : [])
      .map((value) => Number.parseInt(String(value), 10))
      .filter((value) => Number.isInteger(value) && value > 0)
  );

  const collected = [];

  for (const [entryPath, file] of Object.entries(zip.files)) {
    if (file.dir || !/^ppt\/slides\/slide\d+\.xml$/i.test(entryPath)) {
      continue;
    }

    const slideNumber = extractSlideNumberFromPath(entryPath);
    if (!slideNumber) {
      continue;
    }

    if (selectedSlides.size && !selectedSlides.has(slideNumber)) {
      continue;
    }

    try {
      const xml = await file.async('string');
      const parsed = await parseStringPromise(xml);
      const paragraphs = collectParagraphTextsFromSlideXml(parsed);

      collected.push(...collectTermsFromRawText(paragraphs.join('\n')));
    } catch {
      // Keep extraction resilient to malformed slide XML.
    }
  }

  return collapseMedicalTerms([collected]);
}

export async function extractMedicalTermsFromPdf({ filePath }) {
  const fileBuffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });

  try {
    const parsed = await parser.getText();
    const collected = collectTermsFromRawText(String(parsed?.text || ''));
    return collapseMedicalTerms([collected]);
  } finally {
    await parser.destroy().catch(() => {});
  }
}

export async function extractMedicalTermsFromDocument({ filePath, slideNumbers = [] }) {
  const extension = path.extname(filePath || '').toLowerCase();

  if (extension === '.pptx') {
    return extractMedicalTermsFromPptx({ filePath, slideNumbers });
  }

  if (extension === '.pdf') {
    return extractMedicalTermsFromPdf({ filePath });
  }

  throw new Error(`Unsupported glossary source type: ${extension || 'unknown'}. Use .pptx or .pdf.`);
}

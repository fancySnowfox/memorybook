import fs from 'fs/promises';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
import { Document, SentenceSplitter, Settings, VectorStoreIndex } from 'llamaindex';
import { HuggingFaceEmbedding } from '@llamaindex/huggingface';

const FILES_DIR = path.join(process.cwd(), 'files');
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const TOP_K = parseInt(process.env.RAG_TOP_K || '3', 10) || 3;

// Per-user RAG cache: Map<browserId, { retriever, fileSignature, lastBuildAt }>
const userRagCache = new Map();
const USER_RAG_MAX_ENTRIES = 30;

let ragState = {
  index: null,
  retriever: null,
  lastBuildAt: null,
  fileCount: 0,
  fileSignature: '',
};

let buildPromise = null;

function getLocalDocumentFiles(entries) {
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        (/\.(pdf|pptx?)$/i.test(entry.name))
    )
    .map((entry) => ({
      path: path.join(FILES_DIR, entry.name),
      name: entry.name,
      type: /\.pdf$/i.test(entry.name) ? 'pdf' : 'pptx',
    }));
}

async function getDocumentFilesWithSignature() {
  const dirEntries = await fs.readdir(FILES_DIR, { withFileTypes: true }).catch(() => []);
  const documentFiles = getLocalDocumentFiles(dirEntries);

  const signatureParts = await Promise.all(
    documentFiles.map(async (fileInfo) => {
      try {
        const stats = await fs.stat(fileInfo.path);
        return `${fileInfo.name}:${stats.size}:${stats.mtimeMs}`;
      } catch {
        return `${fileInfo.name}:unreadable`;
      }
    })
  );

  signatureParts.sort();

  return {
    documentFiles,
    signature: signatureParts.join('|'),
  };
}

async function loadPdfAsDocument(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });
  const parsed = await parser.getText();
  await parser.destroy();
  const text = (parsed?.text || '').trim();

  if (!text) {
    return null;
  }

  return new Document({
    text,
    metadata: {
      source: path.basename(filePath),
      type: 'pdf',
    },
  });
}

async function loadPowerPointAsDocument(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  const zip = new JSZip();
  await zip.loadAsync(fileBuffer);

  const textParts = [];

  // Extract text from slide XMLs
  // PPTX structure: ppt/slides/slide1.xml, slide2.xml, etc.
  for (const [filename, file] of Object.entries(zip.files)) {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(filename) && !file.dir) {
      try {
        const xmlContent = await file.async('string');
        const parsed = await parseStringPromise(xmlContent);

        // Navigate the XML structure to extract text runs
        const slide = parsed?.['p:sld']?.['p:cSld']?.[0]?.['p:spTree']?.[0]?.['p:sp'] || [];
        const slideArray = Array.isArray(slide) ? slide : [slide];

        for (const shape of slideArray) {
          const textBody = shape?.['p:txBody']?.[0]?.['a:p'] || [];
          const paragraphs = Array.isArray(textBody) ? textBody : [textBody];

          for (const paragraph of paragraphs) {
            const runs = paragraph?.['a:r'] || [];
            const runArray = Array.isArray(runs) ? runs : [runs];

            for (const run of runArray) {
              const runText = run?.['a:t']?.[0];
              if (runText) {
                textParts.push(runText);
              }
            }
          }
        }
      } catch (slideError) {
        console.warn(`Failed to parse slide: ${filename}`, slideError);
      }
    }
  }

  const text = textParts.join(' ').trim();

  if (!text) {
    return null;
  }

  return new Document({
    text,
    metadata: {
      source: path.basename(filePath),
      type: 'powerpoint',
    },
  });
}

async function loadDocumentFile(fileInfo) {
  try {
    if (fileInfo.type === 'pdf') {
      return await loadPdfAsDocument(fileInfo.path);
    } else if (fileInfo.type === 'pptx') {
      return await loadPowerPointAsDocument(fileInfo.path);
    }
  } catch (error) {
    console.warn(`Skipping unreadable file: ${fileInfo.name}`, error);
  }
  return null;
}

async function buildRagIndex() {
  const { documentFiles, signature } = await getDocumentFilesWithSignature();

  if (documentFiles.length === 0) {
    ragState = {
      index: null,
      retriever: null,
      lastBuildAt: new Date().toISOString(),
      fileCount: 0,
      fileSignature: signature,
    };
    return ragState;
  }

  // Use local HuggingFace embedding model through LlamaIndex integration.
  Settings.embedModel = new HuggingFaceEmbedding();

  const docs = [];
  for (const fileInfo of documentFiles) {
    const doc = await loadDocumentFile(fileInfo);
    if (doc) {
      docs.push(doc);
    }
  }

  if (docs.length === 0) {
    ragState = {
      index: null,
      retriever: null,
      lastBuildAt: new Date().toISOString(),
      fileCount: documentFiles.length,
      fileSignature: signature,
    };
    return ragState;
  }

  const splitter = new SentenceSplitter({
    chunkSize: 512,
    chunkOverlap: 80,
  });

  const nodes = splitter.getNodesFromDocuments(docs);
  const index = await VectorStoreIndex.init({ nodes });

  ragState = {
    index,
    retriever: index.asRetriever({ similarityTopK: TOP_K }),
    lastBuildAt: new Date().toISOString(),
    fileCount: documentFiles.length,
    fileSignature: signature,
  };

  return ragState;
}

async function ensureRagIndex(forceRebuild = false) {
  if (!forceRebuild && buildPromise) {
    return buildPromise;
  }

  if (!forceRebuild) {
    let signature;
    try {
      ({ signature } = await getDocumentFilesWithSignature());
    } catch (err) {
      console.warn('RAG: could not read files dir for signature check, using cached index.', err);
      if (ragState.retriever) return ragState;
    }

    // Re-check buildPromise after the await gap — another request may have started building.
    if (buildPromise) {
      return buildPromise;
    }

    const hasBuiltIndex = Boolean(ragState.retriever);
    const filesChanged = signature !== undefined && signature !== (ragState.fileSignature || '');

    if (hasBuiltIndex && !filesChanged) {
      return ragState;
    }

    if (filesChanged) {
      console.log('RAG files changed. Rebuilding index...', {
        previousSignature: ragState.fileSignature,
        nextSignature: signature,
      });
    }
  }

  buildPromise = buildRagIndex().finally(() => {
    buildPromise = null;
  });

  return buildPromise;
}

function normalizeNodeText(nodeWithScore) {
  const node = nodeWithScore?.node;
  if (!node) return '';

  if (typeof node.getContent === 'function') {
    return (node.getContent() || '').trim();
  }

  return (node.text || '').trim();
}

// ── Per-user RAG ──────────────────────────────────────────────────────────────

function sanitizeBrowserId(browserId) {
  // Only allow safe alphanumeric + underscore chars to prevent path traversal
  return typeof browserId === 'string' ? browserId.replace(/[^a-zA-Z0-9_\-]/g, '') : '';
}

async function getUserDocumentFiles(userDir) {
  const entries = await fs.readdir(userDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && /\.(pdf|pptx?)$/i.test(e.name))
    .map((e) => ({
      path: path.join(userDir, e.name),
      name: e.name,
      type: /\.pdf$/i.test(e.name) ? 'pdf' : 'pptx',
    }));
}

async function getUserFileSignature(userDir) {
  const files = await getUserDocumentFiles(userDir);
  const parts = await Promise.all(
    files.map(async (f) => {
      try {
        const s = await fs.stat(f.path);
        return `${f.name}:${s.size}:${s.mtimeMs}`;
      } catch {
        return `${f.name}:unreadable`;
      }
    })
  );
  parts.sort();
  return { files, signature: parts.join('|') };
}

async function buildUserRagIndex(userDir) {
  const { files, signature } = await getUserFileSignature(userDir);
  if (files.length === 0) return { retriever: null, fileSignature: signature, lastBuildAt: new Date().toISOString() };

  Settings.embedModel = new HuggingFaceEmbedding();

  const docs = [];
  for (const fileInfo of files) {
    const doc = await loadDocumentFile(fileInfo);
    if (doc) docs.push(doc);
  }

  if (docs.length === 0) return { retriever: null, fileSignature: signature, lastBuildAt: new Date().toISOString() };

  const splitter = new SentenceSplitter({ chunkSize: 512, chunkOverlap: 80 });
  const nodes = splitter.getNodesFromDocuments(docs);
  const index = await VectorStoreIndex.init({ nodes });

  return {
    retriever: index.asRetriever({ similarityTopK: TOP_K }),
    fileSignature: signature,
    lastBuildAt: new Date().toISOString(),
  };
}

async function ensureUserRagIndex(safeId) {
  const userDir = path.join(UPLOADS_DIR, safeId);
  const { signature } = await getUserFileSignature(userDir);

  const cached = userRagCache.get(safeId);
  if (cached && cached.fileSignature === signature && cached.retriever) {
    return cached;
  }

  const state = await buildUserRagIndex(userDir);

  // Evict oldest entry if cache is full
  if (!userRagCache.has(safeId) && userRagCache.size >= USER_RAG_MAX_ENTRIES) {
    const oldestKey = userRagCache.keys().next().value;
    userRagCache.delete(oldestKey);
  }
  userRagCache.set(safeId, state);
  return state;
}

export async function retrieveRagContextForUser(query, browserId) {
  if (!query || typeof query !== 'string') return { context: '', sources: [], used: false };

  const safeId = sanitizeBrowserId(browserId);
  if (!safeId) return retrieveRagContext(query); // fall back to global

  try {
    const state = await ensureUserRagIndex(safeId);

    if (state.retriever) {
      const results = await state.retriever.retrieve(query);
      if (Array.isArray(results) && results.length > 0) {
        const items = results
          .map((item) => ({ source: item?.node?.metadata?.source || 'uploaded-file', score: item?.score, content: normalizeNodeText(item) }))
          .filter((item) => item.content.length > 0)
          .slice(0, TOP_K);

        if (items.length > 0) {
          const context = items.map((item, idx) => `[${idx + 1}] Source: ${item.source}\n${item.content}`).join('\n\n');
          console.log('[RAG] user files context found:', { safeId, sources: items.map((i) => i.source) });
          return { context, sources: items.map((i) => i.source), used: true, fromUserFiles: true };
        }
      }
    }
  } catch (err) {
    console.warn('[RAG] user index failed, falling back to global:', err.message);
  }

  // Fall back to global index
  return retrieveRagContext(query);
}

export async function retrieveRagContext(query) {  if (!query || typeof query !== 'string') {
    return { context: '', sources: [], used: false };
  }

  const state = await ensureRagIndex(false);

  if (!state.retriever) {
    return { context: '', sources: [], used: false };
  }

  const results = await state.retriever.retrieve(query);

  if (!Array.isArray(results) || results.length === 0) {
    return { context: '', sources: [], used: false };
  }

  const items = results
    .map((item) => {
      const content = normalizeNodeText(item);
      const source = item?.node?.metadata?.source || 'local-pdf';
      return {
        source,
        score: item?.score,
        content,
      };
    })
    .filter((item) => item.content.length > 0)
    .slice(0, TOP_K);

  if (items.length === 0) {
    return { context: '', sources: [], used: false };
  }

  const context = items
    .map((item, idx) => `[${idx + 1}] Source: ${item.source}\n${item.content}`)
    .join('\n\n');

  return {
    context,
    sources: items.map((item) => item.source),
    used: true,
  };
}

export async function reindexRag() {
  const state = await ensureRagIndex(true);
  return {
    status: state.retriever ? 'ready' : 'empty',
    fileCount: state.fileCount,
    lastBuildAt: state.lastBuildAt,
  };
}

export function getRagStatus() {
  return {
    ready: Boolean(ragState.retriever),
    fileCount: ragState.fileCount,
    lastBuildAt: ragState.lastBuildAt,
  };
}

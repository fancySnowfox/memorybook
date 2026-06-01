const DEFAULT_MODEL_ID = process.env.AI_MODEL_ID || 'router:knowledge-base-document-intelligence-01';
const DEFAULT_TASK_ID = process.env.AI_TASK_ID || 'knowledge-base-customer-support';
const DEFAULT_GRADIENT_BASE_URL = 'https://inference.do-ai.run/v1';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
import { retrieveRagContext, retrieveRagContextForUser } from '../utils/rag-llamaindex.js';
import { matchFaq } from '../utils/faq-matcher.js';
import { resolveRequestOwnerId } from '../utils/owner-id.js';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const CONVERTED_VIDEOS_DIR = path.join(UPLOADS_DIR, 'converted-videos');

function sanitizeBrowserId(browserId) {
  return typeof browserId === 'string' ? browserId.replace(/[^a-zA-Z0-9_\-]/g, '') : '';
}



const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wmv', '.flv']);
const TEXT_READABLE_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json']);
const MAX_CONTENT_STATS_FILES = 20;
const MAX_TEXT_READ_BYTES = 5 * 1024 * 1024;

async function getCurrentUserUploadCount(browserId, extensionFilter = null) {
  const safeId = sanitizeBrowserId(browserId);
  if (!safeId) {
    return { count: 0, scoped: false };
  }

  const userDir = path.join(UPLOADS_DIR, safeId);
  const entries = await fs.readdir(userDir, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile());
  const count = extensionFilter
    ? files.filter((f) => extensionFilter.has(path.extname(f.name).toLowerCase())).length
    : files.length;
  return { count, scoped: true };
}

async function getConvertedVideoCount(browserId) {
  const safeId = sanitizeBrowserId(browserId);
  if (!safeId) {
    return 0;
  }

  const userConvertedDir = path.join(CONVERTED_VIDEOS_DIR, safeId);
  const entries = await fs.readdir(userConvertedDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile() && /\.mp4$/i.test(entry.name)).length;
}

async function getCurrentUserLargestUploadFile(browserId) {
  const safeId = sanitizeBrowserId(browserId);
  if (!safeId) {
    return { scoped: false };
  }

  const userDir = path.join(UPLOADS_DIR, safeId);
  const entries = await fs.readdir(userDir, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile());

  let largest = null;
  for (const file of files) {
    const fullPath = path.join(userDir, file.name);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isFile()) {
      continue;
    }

    if (!largest || stats.size > largest.size) {
      largest = {
        storedName: file.name,
        size: stats.size,
        uploadedAt: stats.mtime.toISOString(),
      };
    }
  }

  if (!largest) {
    return { scoped: true, found: false };
  }

  const dashIdx = largest.storedName.indexOf('-');
  const originalName = dashIdx !== -1 ? largest.storedName.slice(dashIdx + 1) : largest.storedName;
  return {
    scoped: true,
    found: true,
    ...largest,
    originalName,
  };
}

function buildUploadCountAnswer({ count, scoped }) {
  if (!scoped) {
    return 'I could not determine your current folder identity, so I cannot count your uploaded files right now.';
  }

  const noun = count === 1 ? 'file' : 'files';
  return `In your current Memorybook Creator folder, there are ${count} uploaded ${noun}.`;
}

function buildVideoUploadCountAnswer({ count, scoped, convertedVideoCount = 0 }) {
  if (!scoped) {
    return 'I could not determine your current folder identity, so I cannot count your uploaded video files right now.';
  }

  const personalNoun = count === 1 ? 'video file' : 'video files';
  const convertedNoun = convertedVideoCount === 1 ? 'converted video' : 'converted videos';
  const total = count + convertedVideoCount;
  const totalNoun = total === 1 ? 'video file' : 'video files';
  return `In your current Memorybook Creator folder, there are ${count} uploaded ${personalNoun}. In stored converted videos, there are ${convertedVideoCount} ${convertedNoun}. Total video files counted: ${total} ${totalNoun}.`;
}

function buildLargestUploadAnswer(result) {
  if (!result?.scoped) {
    return 'I could not determine your current folder identity, so I cannot check your largest uploaded file right now.';
  }

  if (!result.found) {
    return 'I did not find any uploaded files in your current Memorybook Creator folder.';
  }

  return `Your largest uploaded file is ${result.originalName} (${formatBytes(result.size)}), uploaded at ${new Date(result.uploadedAt).toLocaleString()}.`;
}

function countWords(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return 0;
  }
  return normalized.split(/\s+/).length;
}

function isContentStatisticsQuery(text) {
  if (typeof text !== 'string') {
    return false;
  }

  const normalized = text.toLowerCase();
  const hasStatsKeyword = /(stat|stats|statistics|summary|breakdown|analy[sz]e|analysis)/.test(normalized);
  const hasScopeKeyword = /(content|contents|document|documents|file|files|upload|uploads|vault|folder|word|text|character)/.test(normalized);
  return hasStatsKeyword && hasScopeKeyword;
}

function isLargestUploadQuery(text) {
  if (typeof text !== 'string') {
    return false;
  }

  const normalized = text.toLowerCase();
  const hasLargestKeyword = /(largest|biggest|max(imum)?\s+size|biggest\s+size)/.test(normalized);
  const hasFileKeyword = /(file|files|upload|uploaded|uploads|vault|folder)/.test(normalized);
  return hasLargestKeyword && hasFileKeyword;
}

function wantsTextStatistics(text) {
  if (typeof text !== 'string') {
    return false;
  }

  const normalized = text.toLowerCase();
  return /(content|word|words|text|character|characters|read|inside)/.test(normalized);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

async function extractPdfTextStats(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });
  try {
    const parsed = await parser.getText();
    const text = String(parsed?.text || '');
    return {
      words: countWords(text),
      characters: text.length,
      sourceType: 'pdf',
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractPptxTextStats(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(fileBuffer);
  const textParts = [];

  for (const [filename, file] of Object.entries(zip.files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(filename) || file.dir) {
      continue;
    }

    try {
      const xmlContent = await file.async('string');
      const parsed = await parseStringPromise(xmlContent);
      const slideShapes = parsed?.['p:sld']?.['p:cSld']?.[0]?.['p:spTree']?.[0]?.['p:sp'] || [];
      const shapeArray = Array.isArray(slideShapes) ? slideShapes : [slideShapes];

      for (const shape of shapeArray) {
        const paragraphs = shape?.['p:txBody']?.[0]?.['a:p'] || [];
        const paragraphArray = Array.isArray(paragraphs) ? paragraphs : [paragraphs];

        for (const paragraph of paragraphArray) {
          const runs = paragraph?.['a:r'] || [];
          const runArray = Array.isArray(runs) ? runs : [runs];

          for (const run of runArray) {
            const runText = run?.['a:t']?.[0];
            if (runText) {
              textParts.push(String(runText));
            }
          }
        }
      }
    } catch {
      // Ignore a malformed slide and keep processing remaining slides.
    }
  }

  const text = textParts.join(' ');
  return {
    words: countWords(text),
    characters: text.length,
    sourceType: 'pptx',
  };
}

async function extractOdpTextStats(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(fileBuffer);
  const textParts = [];

  try {
    const contentXml = zip.file('content.xml');
    if (contentXml) {
      const xmlContent = await contentXml.async('string');
      const parsed = await parseStringPromise(xmlContent);
      const pages = parsed?.['office:document-content']?.['office:body']?.[0]?.['draw:page'] || [];
      const pageArray = Array.isArray(pages) ? pages : [pages];

      for (const page of pageArray) {
        const frames = page?.['draw:frame'] || [];
        const frameArray = Array.isArray(frames) ? frames : [frames];

        for (const frame of frameArray) {
          const textBoxes = frame?.['draw:text-box'] || [];
          const textBoxArray = Array.isArray(textBoxes) ? textBoxes : [textBoxes];

          for (const textBox of textBoxArray) {
            const paragraphs = textBox?.['text:p'] || [];
            const paragraphArray = Array.isArray(paragraphs) ? paragraphs : [paragraphs];

            for (const paragraph of paragraphArray) {
              const runs = paragraph?.['text:span'] || [];
              const runArray = Array.isArray(runs) ? runs : [runs];

              for (const run of runArray) {
                const runText = run?.['_'];
                if (runText) {
                  textParts.push(String(runText));
                }
              }
            }
          }
        }
      }
    }
  } catch {
    // Ignore parsing errors and continue
  }

  const text = textParts.join(' ');
  return {
    words: countWords(text),
    characters: text.length,
    sourceType: 'odp',
  };
}

async function extractPlainTextStats(filePath) {
  const stats = await fs.stat(filePath);
  if (stats.size > MAX_TEXT_READ_BYTES) {
    return {
      words: 0,
      characters: 0,
      sourceType: 'text',
      skipped: true,
      reason: `File too large for inline text stats (> ${formatBytes(MAX_TEXT_READ_BYTES)}).`,
    };
  }

  const text = await fs.readFile(filePath, 'utf8');
  return {
    words: countWords(text),
    characters: text.length,
    sourceType: 'text',
  };
}

async function getCurrentUserContentStatistics(browserId, options = {}) {
  const safeId = sanitizeBrowserId(browserId);
  if (!safeId) {
    return { scoped: false };
  }

  const includeTextStats = Boolean(options.includeTextStats);
  const userDir = path.join(UPLOADS_DIR, safeId);
  const entries = await fs.readdir(userDir, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile());

  const stats = {
    scoped: true,
    totalFiles: files.length,
    totalBytes: 0,
    videoFiles: 0,
    documentFiles: 0,
    extensionCounts: {},
    textStats: {
      processedFiles: 0,
      skippedFiles: 0,
      words: 0,
      characters: 0,
    },
  };

  const filesForTextStats = [];

  for (const file of files) {
    const fullPath = path.join(userDir, file.name);
    const ext = path.extname(file.name).toLowerCase() || '(no-ext)';
    stats.extensionCounts[ext] = (stats.extensionCounts[ext] || 0) + 1;

    const fileInfo = await fs.stat(fullPath).catch(() => null);
    if (!fileInfo || !fileInfo.isFile()) {
      continue;
    }

    stats.totalBytes += fileInfo.size;

    if (VIDEO_EXTENSIONS.has(ext)) {
      stats.videoFiles += 1;
    }

    if (['.pdf', '.ppt', '.pptx', '.odp', '.doc', '.docx', '.xls', '.xlsx'].includes(ext)) {
      stats.documentFiles += 1;
    }

    if (!includeTextStats) {
      continue;
    }

    if (['.pdf', '.pptx', '.odp', ...TEXT_READABLE_EXTENSIONS].includes(ext)) {
      filesForTextStats.push({ path: fullPath, ext });
    }
  }

  if (includeTextStats) {
    for (const file of filesForTextStats.slice(0, MAX_CONTENT_STATS_FILES)) {
      try {
        let textStats = null;
        if (file.ext === '.pdf') {
          textStats = await extractPdfTextStats(file.path);
        } else if (file.ext === '.pptx') {
          textStats = await extractPptxTextStats(file.path);
        } else if (file.ext === '.odp') {
          textStats = await extractOdpTextStats(file.path);
        } else if (TEXT_READABLE_EXTENSIONS.has(file.ext)) {
          textStats = await extractPlainTextStats(file.path);
        }

        if (!textStats) {
          continue;
        }

        if (textStats.skipped) {
          stats.textStats.skippedFiles += 1;
          continue;
        }

        stats.textStats.processedFiles += 1;
        stats.textStats.words += textStats.words;
        stats.textStats.characters += textStats.characters;
      } catch {
        stats.textStats.skippedFiles += 1;
      }
    }
  }

  return stats;
}

function buildContentStatisticsAnswer(stats, includeTextStats) {
  if (!stats?.scoped) {
    return 'I could not determine your current folder identity, so I cannot compute your local upload statistics right now.';
  }

  const extensionSummary = Object.entries(stats.extensionCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([ext, count]) => `${ext}: ${count}`)
    .join(', ');

  let answer = `In your current Memorybook Creator folder: total files ${stats.totalFiles}, total size ${formatBytes(stats.totalBytes)}, video files ${stats.videoFiles}, document files ${stats.documentFiles}.`;

  if (extensionSummary) {
    answer += ` Top file types: ${extensionSummary}.`;
  }

  if (includeTextStats) {
    answer += ` Content stats (processed ${stats.textStats.processedFiles} files): ${stats.textStats.words} words and ${stats.textStats.characters} characters.`;
    if (stats.textStats.skippedFiles > 0) {
      answer += ` Skipped ${stats.textStats.skippedFiles} files due to unsupported/large content parsing.`;
    }
  }

  return answer;
}

function isVideoUploadCountQuery(text) {
  if (typeof text !== 'string') {
    return false;
  }

  const normalized = text.toLowerCase();
  const hasVideoKeyword = /(video|videos|mov|mp4)/.test(normalized);
  const hasCountKeyword = /(how many|count|number of|total)/.test(normalized);
  const hasUploadContext = /(upload|uploaded|uploads|vault|folder|file|files)/.test(normalized);
  return hasVideoKeyword && hasCountKeyword && hasUploadContext;
}

function buildMessagePreview(text, maxLength = 180) {
  if (typeof text !== 'string') {
    return '';
  }

  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength)}...`;
}

function logFaqTrace(requestId, stage, details = {}) {
  console.log('[chat][faq-trace]', {
    requestId,
    stage,
    ...details,
  });
}



function normalizeChatScope(scope) {
  return scope === 'general' ? 'general' : 'app';
}

function normalizeBaseUrl(baseUrl) {
  return (baseUrl || DEFAULT_GRADIENT_BASE_URL).trim().replace(/\/+$/, '');
}

function isInferenceBaseUrl(baseUrl) {
  return /inference\.do-ai\.run\/v1$/i.test(baseUrl);
}

function isApiV1BaseUrl(baseUrl) {
  return /\/api\/v1$/i.test(baseUrl);
}

function buildModelsEndpoint(baseUrl) {
  if (isInferenceBaseUrl(baseUrl) || isApiV1BaseUrl(baseUrl)) {
    return `${baseUrl}/models`;
  }

  // Public router or agent endpoint style (base endpoint + /api/v1/...)
  return `${baseUrl}/api/v1/models`;
}

function buildChatCompletionsEndpoint(baseUrl) {
  if (isInferenceBaseUrl(baseUrl) || isApiV1BaseUrl(baseUrl)) {
    return `${baseUrl}/chat/completions`;
  }

  // Public router or agent endpoint style (base endpoint + /api/v1/...)
  return `${baseUrl}/api/v1/chat/completions`;
}

/**
 * Fetch available models from Gradient API
 */
async function fetchAvailableModels() {
  const gradientApiKey = process.env.GRADIENT_API_KEY;
  const gradientBaseUrl = normalizeBaseUrl(process.env.GRADIENT_BASE_URL);
  const modelsEndpoint = buildModelsEndpoint(gradientBaseUrl);

  if (!gradientApiKey) {  
    throw new Error('GRADIENT_API_KEY not configured');
  }

  try {
    console.log('Fetching models from:', modelsEndpoint);
    
    const response = await fetch(modelsEndpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${gradientApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('API Response Status:', response.status, response.statusText);

    if (!response.ok) {
      const responseText = await response.text();

      // Public router endpoints may not expose /models; fall back to configured default model.
      if (!isInferenceBaseUrl(gradientBaseUrl) && (response.status === 403 || response.status === 404)) {
        console.warn('Models endpoint unavailable for router endpoint; using configured default model only.');
        return [{
          id: DEFAULT_MODEL_ID,
          name: DEFAULT_MODEL_ID,
          owned_by: 'DigitalOcean Router',
        }];
      }

      console.error('API Error Response:', responseText);
      throw new Error(`API returned status ${response.status}: ${response.statusText} - ${responseText}`);
    }

    const data = await response.json();
    
    console.log('Raw Gradient API response:', JSON.stringify(data, null, 2));

    // Handle different response formats
    let modelsList = [];
    
    if (Array.isArray(data)) {
      // Direct array response
      console.log('Response is direct array');
      modelsList = data;
    } else if (data.data && Array.isArray(data.data)) {
      // Response with data property
      console.log('Response has data property');
      modelsList = data.data;
    } else if (data.object === 'list' && data.data) {
      // OpenAI-compatible format
      console.log('Response is OpenAI-compatible format');
      modelsList = data.data;
    } else {
      console.warn('Unexpected response format:', Object.keys(data));
      modelsList = [];
    }

    // Convert to standard model format
    const models = modelsList.map((model) => {
      console.log('Processing model:', model);
      return {
        id: model.id,
        name: model.id,
        owned_by: model.owned_by || 'Gradient',
      };
    }).filter(m => m.id); // Filter out models without ID

    console.log('Final parsed models:', models);

    if (models.length === 0) {
      console.warn('No valid models found in response');
    }

    return models;
  } catch (error) {
    console.error('Error fetching models:', error);
    throw new Error(`Failed to fetch available models: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * GET endpoint to retrieve available models
 */
async function getModels(req, res) {
  try {
    const gradientBaseUrl = normalizeBaseUrl(process.env.GRADIENT_BASE_URL);

    console.log('=== Models Endpoint Called ===');
    console.log('GRADIENT_API_KEY configured:', !!process.env.GRADIENT_API_KEY);
    console.log('GRADIENT_BASE_URL:', gradientBaseUrl);
    
    const models = await fetchAvailableModels();
    
    console.log('Successfully fetched models:', models.length);
    res.json({
      status: 'success',
      models,
      defaultModel: DEFAULT_MODEL_ID,
    });
  } catch (error) {
    console.error('=== Models Endpoint Error ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    console.error('Full error:', error);
    
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to fetch models',
      details: error instanceof Error ? error.stack : undefined,
    });
  }
}

/**
 * POST endpoint for chat streaming
 */
async function chat(req, res) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  try {
    // Validate environment
    const gradientApiKey = process.env.GRADIENT_API_KEY;
    const gradientBaseUrl = normalizeBaseUrl(process.env.GRADIENT_BASE_URL);
    const chatEndpoint = buildChatCompletionsEndpoint(gradientBaseUrl);

    console.log('[chat] request started', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      baseUrl: gradientBaseUrl,
      endpoint: chatEndpoint,
    });

    if (!gradientApiKey) {
      console.error('Error: GRADIENT_API_KEY is not set');
      return res.status(500).json({ 
        error: 'API configuration error: GRADIENT_API_KEY is not set',
        details: 'Please configure your Gradient API key in environment variables',
      });
    }

    // Validate messages
    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request',
        details: 'No messages provided',
      });
    }

    // Use fixed router model/task for chat retrieval workflow
    const modelId = DEFAULT_MODEL_ID;
    const taskId = DEFAULT_TASK_ID;
    const temperature = req.body?.temperature ?? 0.7;
    const maxTokens = parseInt(req.body?.maxTokens ?? 2000) || 2000;

    const latestUserMessage = [...messages].reverse().find((message) => message?.role === 'user')?.content;
    const browserId = resolveRequestOwnerId(req);
    const chatScope = normalizeChatScope(req.body?.scope);
    const queryPreview = buildMessagePreview(latestUserMessage);
    const shouldCheckVideoCount = chatScope === 'app' && isVideoUploadCountQuery(latestUserMessage);
    const shouldCheckLargestUpload = chatScope === 'app' && isLargestUploadQuery(latestUserMessage);
    const shouldCheckContentStats = chatScope === 'app' && isContentStatisticsQuery(latestUserMessage);

    logFaqTrace(requestId, 'routing-start', {
      scope: chatScope,
      queryPreview,
      checkVideoCount: shouldCheckVideoCount,
      checkLargestUpload: shouldCheckLargestUpload,
      checkContentStats: shouldCheckContentStats,
      browserId: sanitizeBrowserId(browserId) || 'missing',
    });

    // Route explicit video count questions first to avoid semantic FAQ ambiguity.
    if (shouldCheckVideoCount) {
      const uploadStats = await getCurrentUserUploadCount(browserId, VIDEO_EXTENSIONS);
      const convertedVideoCount = await getConvertedVideoCount(browserId);
      const localAnswer = buildVideoUploadCountAnswer({ ...uploadStats, convertedVideoCount });
      logFaqTrace(requestId, 'resolved-direct-video-count', {
        queryPreview,
        scoped: uploadStats.scoped,
        videoUploadCount: uploadStats.count,
        convertedVideoCount,
      });
      console.log('[chat] locally answered direct video count query', {
        requestId,
        browserId: sanitizeBrowserId(browserId) || 'missing',
        videoUploadCount: uploadStats.count,
        convertedVideoCount,
        scope: chatScope,
      });

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.write(localAnswer);
      res.end();
      return;
    }

    if (shouldCheckLargestUpload) {
      const largestUpload = await getCurrentUserLargestUploadFile(browserId);
      const localAnswer = buildLargestUploadAnswer(largestUpload);
      logFaqTrace(requestId, 'resolved-direct-largest-upload', {
        queryPreview,
        scoped: Boolean(largestUpload?.scoped),
        found: Boolean(largestUpload?.found),
        fileName: largestUpload?.originalName || null,
        fileSize: largestUpload?.size || null,
      });

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.write(localAnswer);
      res.end();
      return;
    }

    // Route content/statistics queries to local deterministic stats instead of semantic/model replies.
    if (shouldCheckContentStats) {
      const includeTextStats = wantsTextStatistics(latestUserMessage);
      const stats = await getCurrentUserContentStatistics(browserId, { includeTextStats });
      const localAnswer = buildContentStatisticsAnswer(stats, includeTextStats);
      logFaqTrace(requestId, 'resolved-direct-content-stats', {
        queryPreview,
        includeTextStats,
        totalFiles: stats?.totalFiles ?? null,
        scoped: Boolean(stats?.scoped),
      });
      console.log('[chat] locally answered content statistics query', {
        requestId,
        browserId: sanitizeBrowserId(browserId) || 'missing',
        scope: chatScope,
        totalFiles: stats?.totalFiles ?? null,
        includeTextStats,
      });

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.write(localAnswer);
      res.end();
      return;
    }

    // Route app/self FAQ questions locally before inference calls.
    if (chatScope === 'app' && latestUserMessage) {
      try {
        const faqMatch = await matchFaq(latestUserMessage);
        if (faqMatch) {
          let localAnswer = '';

          if (faqMatch.isDynamic && faqMatch.faqId === 'upload_count') {
            const uploadStats = await getCurrentUserUploadCount(browserId);
            localAnswer = buildUploadCountAnswer(uploadStats);
            console.log('[chat] locally answered FAQ (semantic)', {
              requestId,
              faqId: faqMatch.faqId,
              score: faqMatch.score.toFixed(3),
              browserId: sanitizeBrowserId(browserId) || 'missing',
              uploadCount: uploadStats.count,
              scope: chatScope,
            });
          } else if (faqMatch.isDynamic && faqMatch.faqId === 'video_upload_count') {
            const uploadStats = await getCurrentUserUploadCount(browserId, VIDEO_EXTENSIONS);
            const convertedVideoCount = await getConvertedVideoCount(browserId);
            localAnswer = buildVideoUploadCountAnswer({ ...uploadStats, convertedVideoCount });
            console.log('[chat] locally answered FAQ (semantic)', {
              requestId,
              faqId: faqMatch.faqId,
              score: faqMatch.score.toFixed(3),
              browserId: sanitizeBrowserId(browserId) || 'missing',
              videoUploadCount: uploadStats.count,
              convertedVideoCount,
              scope: chatScope,
            });
          } else if (!faqMatch.isDynamic) {
            localAnswer = faqMatch.answer;
            console.log('[chat] locally answered FAQ (semantic)', {
              requestId,
              faqId: faqMatch.faqId,
              score: faqMatch.score.toFixed(3),
              scope: chatScope,
            });
          }

          logFaqTrace(requestId, 'semantic-match', {
            queryPreview,
            faqId: faqMatch.faqId,
            score: Number(faqMatch.score.toFixed(3)),
            isDynamic: faqMatch.isDynamic,
            producedLocalAnswer: Boolean(localAnswer),
          });

          if (localAnswer) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.write(localAnswer);
            res.end();
            return;
          }

          logFaqTrace(requestId, 'semantic-match-no-local-answer', {
            queryPreview,
            faqId: faqMatch.faqId,
          });
        } else {
          logFaqTrace(requestId, 'semantic-no-match', {
            queryPreview,
          });
        }
      } catch (faqError) {
        logFaqTrace(requestId, 'semantic-error', {
          queryPreview,
          message: faqError instanceof Error ? faqError.message : String(faqError),
        });
      }
    }

    logFaqTrace(requestId, 'fallback-to-rag-or-inference', {
      queryPreview,
      scope: chatScope,
    });

    let messagesForModel = messages;
    let ragUsed = false;
    let ragSources = [];

    // Only retrieve RAG for app scope, never for general/cloud scope
    if (chatScope === 'app') {
      if (typeof latestUserMessage === 'string' && latestUserMessage.trim().length > 0) {
        try {
          const rag = browserId
            ? await retrieveRagContextForUser(latestUserMessage, browserId)
            : await retrieveRagContext(latestUserMessage);
          if (rag.used && rag.context) {
            const ragSystemMessage = {
              role: 'system',
              content: `Use the retrieved local PDF context when relevant. If context is insufficient, say so and continue with best effort.\n\nRetrieved context:\n${rag.context}`,
            };

            messagesForModel = [ragSystemMessage, ...messages];
            ragUsed = true;
            ragSources = rag.sources;
            console.log('RAG context attached:', { sourceCount: rag.sources.length, sources: rag.sources });
            console.log('RAG attached text chunk:', {
              requestId,
              characterCount: rag.context.length,
              text: rag.context,
            });
          } else {
            console.log('[chat] RAG not used', { requestId });
          }
        } catch (ragError) {
          console.warn('RAG retrieval failed, continuing without RAG:', ragError);
        }
      }
    } else {
      // General/cloud scope: never use RAG
      console.log('[chat] general scope selected; skipping RAG entirely', { requestId });
    }

    console.log('Chat request:', {
      requestId,
      modelId, 
      taskId,
      messageCount: messages.length, 
      temperature, 
      maxTokens,
      scope: chatScope,
      ragUsed,
    });

    // Call Gradient API
    const response = await fetch(chatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gradientApiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        task: taskId,
        messages: messagesForModel,
        temperature: temperature,
        max_tokens: maxTokens,
        stream: false, // We'll handle streaming ourselves if needed
      }),
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      let errorDetails = `HTTP ${response.status}: ${response.statusText}`;
      try {
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          errorDetails = errorData.error?.message || errorData.message || errorDetails;
        } else {
          const text = await response.text();
          errorDetails = text || errorDetails;
        }
      } catch (e) {
        // Fallback to status text
      }

      // Check for subscription tier issues
      if (errorDetails.toLowerCase().includes('not available for your subscription') || 
          errorDetails.toLowerCase().includes('subscription tier')) {
        console.error('Model not available for subscription tier:', modelId);
        const suggestion = modelId !== DEFAULT_MODEL_ID 
          ? `The model "${modelId}" is not available for your subscription tier. Try using the default model: "${DEFAULT_MODEL_ID}"`
          : `The model "${modelId}" is not available for your subscription tier. Please check your DigitalOcean Gradient account.`;
        
        return res.status(400).json({
          error: 'Model not available',
          details: suggestion,
          originalError: errorDetails,
          availableDefault: DEFAULT_MODEL_ID,
          model: modelId,
        });
      }

      console.error('Gradient API error:', errorDetails);
      console.error('[chat] request failed', {
        requestId,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
      });
      return res.status(response.status).json({
        error: 'Gradient API error',
        details: errorDetails,
        model: modelId,
      });
    }

    const responseContentType = (response.headers.get('content-type') || '').toLowerCase();
    const rawBody = await response.text();

    console.log('[chat] inference response received', {
      requestId,
      status: response.status,
      contentType: responseContentType,
      bodyLength: rawBody.length,
      bodyPreview: rawBody.slice(0, 2000),
    });

    let data;
    try {
      data = responseContentType.includes('application/json')
        ? JSON.parse(rawBody)
        : { raw: rawBody };
    } catch (parseError) {
      console.error('[chat] failed to parse inference response', {
        requestId,
        message: parseError instanceof Error ? parseError.message : String(parseError),
      });
      return res.status(502).json({
        error: 'Invalid response from inference server',
        details: 'The inference server response could not be parsed.',
      });
    }

    const content = data.choices?.[0]?.message?.content || data.raw || '';

    if (!content) {
      console.warn('Empty response from Gradient API:', data);
      return res.status(500).json({
        error: 'Empty response from API',
        details: 'The AI model returned an empty response',
      });
    }

    // Send response as plain text
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.write(content);
    res.end();

    console.log('[chat] request completed', {
      requestId,
      status: 200,
      elapsedMs: Date.now() - startedAt,
      ragUsed,
      ragSourceCount: ragSources.length,
    });

  } catch (error) {
    console.error('Chat error:', error);
    console.error('[chat] request crashed', {
      requestId,
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : 'Internal server error',
    });
    if (!res.headersSent) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      res.status(500).json({ 
        error: 'Chat request failed',
        details: message,
      });
    }
  }
}

export { chat, getModels };
export default chat;

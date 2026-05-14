/**
 * faq-matcher.js
 *
 * Semantic FAQ matching using HuggingFace embeddings (cosine similarity).
 * At startup, embeddings are pre-computed for every question in app-faq.json.
 * Incoming queries are embedded on-the-fly and matched against the stored vectors.
 */

import { HuggingFaceEmbedding } from '@llamaindex/huggingface';
import { createRequire } from 'module';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAQ_PATH = path.join(__dirname, '..', 'data', 'app-faq.json');

// Similarity threshold — queries below this score fall through to inference.
const SIMILARITY_THRESHOLD = parseFloat(process.env.FAQ_SIMILARITY_THRESHOLD || '0.72');

let embedModel = null;
let faqEntries = [];       // raw FAQ objects from JSON
let questionVectors = [];  // { faqId, question, vector }
let initPromise = null;

function getEmbedModel() {
  if (!embedModel) {
    embedModel = new HuggingFaceEmbedding({
      modelType: 'BAAI/bge-small-en-v1.5',
    });
  }
  return embedModel;
}

function dotProduct(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function magnitude(v) {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

function cosineSimilarity(a, b) {
  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA === 0 || magB === 0) return 0;
  return dotProduct(a, b) / (magA * magB);
}

async function initFaqMatcher() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const raw = await readFile(FAQ_PATH, 'utf-8');
      faqEntries = JSON.parse(raw);

      const model = getEmbedModel();

      // Flatten all questions with their parent FAQ id
      const allQuestions = faqEntries.flatMap((entry) =>
        entry.questions.map((q) => ({ faqId: entry.id, question: q }))
      );

      console.log(`[faq-matcher] pre-computing embeddings for ${allQuestions.length} FAQ questions…`);

      const vectors = await model.getTextEmbeddingsBatch(
        allQuestions.map((q) => q.question)
      );

      questionVectors = allQuestions.map((q, i) => ({
        faqId: q.faqId,
        question: q.question,
        vector: vectors[i],
      }));

      console.log(`[faq-matcher] ready — ${questionVectors.length} vectors cached`);
    } catch (err) {
      console.error('[faq-matcher] init failed:', err);
      // Non-fatal: FAQ matching will be skipped if not initialised
      initPromise = null;
    }
  })();

  return initPromise;
}

/**
 * Find the best-matching FAQ entry for a query.
 * Returns { faqId, answer, score } or null if nothing exceeds the threshold.
 */
async function matchFaq(query) {
  if (!query || typeof query !== 'string') return null;

  // Lazy init — safe to call multiple times
  await initFaqMatcher();

  if (questionVectors.length === 0) return null;

  const model = getEmbedModel();
  let queryVector;
  try {
    queryVector = await model.getTextEmbedding(query);
  } catch (err) {
    console.warn('[faq-matcher] failed to embed query:', err.message);
    return null;
  }

  let best = { faqId: null, score: -Infinity };
  for (const qv of questionVectors) {
    const score = cosineSimilarity(queryVector, qv.vector);
    if (score > best.score) {
      best = { faqId: qv.faqId, score };
    }
  }

  if (best.score < SIMILARITY_THRESHOLD) {
    console.log('[faq-matcher] best score below threshold', { score: best.score.toFixed(3), threshold: SIMILARITY_THRESHOLD });
    return null;
  }

  const entry = faqEntries.find((e) => e.id === best.faqId);
  if (!entry) return null;

  console.log('[faq-matcher] matched', { faqId: best.faqId, score: best.score.toFixed(3) });

  return {
    faqId: best.faqId,
    answer: entry.answer,
    score: best.score,
    isDynamic: entry.answer === '__dynamic__',
  };
}

export { matchFaq, initFaqMatcher };

import fs from 'node:fs';
import path from 'node:path';

const AUDIO_POSTPROCESS_ENABLED = !['0', 'false', 'no', 'off'].includes(String(process.env.AUDIO_POSTPROCESS_ENABLED || 'true').toLowerCase());
const AUDIO_MEDICAL_GLOSSARY_PATH = process.env.AUDIO_MEDICAL_GLOSSARY_PATH
  ? path.resolve(process.env.AUDIO_MEDICAL_GLOSSARY_PATH)
  : path.resolve(process.cwd(), 'server', 'data', 'medical-glossary.json');
const AUDIO_MEDICAL_TERMS = String(process.env.AUDIO_MEDICAL_TERMS || '');

let cachedGlossary = null;

function normalizeWord(value) {
  return String(value || '').trim().toLowerCase();
}

function levenshtein(a, b) {
  const left = normalizeWord(a);
  const right = normalizeWord(b);

  if (left === right) {
    return 0;
  }
  if (!left.length) {
    return right.length;
  }
  if (!right.length) {
    return left.length;
  }

  const rows = left.length + 1;
  const cols = right.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    dp[i][0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    dp[0][j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[rows - 1][cols - 1];
}

function splitGlossaryTermsFromEnv() {
  return AUDIO_MEDICAL_TERMS
    .split(/[\n,;]/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function readGlossaryFileTerms() {
  if (!fs.existsSync(AUDIO_MEDICAL_GLOSSARY_PATH)) {
    return [];
  }

  try {
    const content = fs.readFileSync(AUDIO_MEDICAL_GLOSSARY_PATH, 'utf8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => String(item || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function loadGlossary() {
  if (cachedGlossary) {
    return cachedGlossary;
  }

  const fileTerms = readGlossaryFileTerms();
  const envTerms = splitGlossaryTermsFromEnv();
  const allTerms = [...fileTerms, ...envTerms]
    .map((term) => term.trim())
    .filter((term) => term.length >= 4);

  const byNormalized = new Map();
  for (const term of allTerms) {
    const normalized = normalizeWord(term).replace(/\s+/g, ' ');
    if (!normalized) {
      continue;
    }
    byNormalized.set(normalized, term);
  }

  const terms = Array.from(byNormalized.entries()).map(([normalized, original]) => ({
    normalized,
    original,
  }));

  const singleWordTerms = terms.filter((entry) => !entry.normalized.includes(' '));
  const phraseTerms = terms.filter((entry) => entry.normalized.includes(' '));

  const phraseTermsByWordCount = new Map();
  for (const entry of phraseTerms) {
    const wordCount = entry.normalized.split(' ').length;
    if (!phraseTermsByWordCount.has(wordCount)) {
      phraseTermsByWordCount.set(wordCount, []);
    }
    phraseTermsByWordCount.get(wordCount).push(entry);
  }

  const phraseWordCounts = Array.from(phraseTermsByWordCount.keys()).sort((a, b) => b - a);

  cachedGlossary = {
    size: terms.length,
    singleWordTerms,
    phraseTermsByWordCount,
    phraseWordCounts,
  };

  return cachedGlossary;
}

function findBestGlossaryMatch(word, glossaryTerms) {
  const normalizedWord = normalizeWord(word);
  if (!/^[a-z][a-z'-]{2,}$/i.test(normalizedWord)) {
    return null;
  }

  let best = null;
  for (const term of glossaryTerms) {
    if (term.normalized === normalizedWord) {
      return null;
    }

    if (term.normalized[0] !== normalizedWord[0]) {
      continue;
    }

    const distance = levenshtein(normalizedWord, term.normalized);
    const maxLen = Math.max(normalizedWord.length, term.normalized.length);
    const ratio = distance / maxLen;
    const limit = maxLen <= 7 ? 2 : 3;

    if (distance > limit || ratio > 0.34) {
      continue;
    }

    if (!best || ratio < best.ratio) {
      best = {
        replacement: term.original,
        normalizedReplacement: term.normalized,
        distance,
        ratio,
      };
    }
  }

  return best;
}

function applyWordGlossaryToText(text, glossaryTerms, correctionLimit) {
  const corrections = [];
  if (!text || !glossaryTerms.length) {
    return { text: text || '', corrections };
  }

  let used = 0;
  const updated = String(text).replace(/\b([A-Za-z][A-Za-z'\-]{2,})\b/g, (match, word) => {
    if (used >= correctionLimit) {
      return match;
    }

    const best = findBestGlossaryMatch(word, glossaryTerms);
    if (!best) {
      return match;
    }

    used += 1;
    corrections.push({
      from: word,
      to: best.replacement,
      distance: best.distance,
    });
    return best.replacement;
  });

  return { text: updated, corrections };
}

function collectWordTokens(text) {
  const tokens = [];
  const regex = /[A-Za-z][A-Za-z'\-]*/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const value = match[0];
    tokens.push({
      raw: value,
      normalized: normalizeWord(value),
      start: match.index,
      end: match.index + value.length,
    });
  }
  return tokens;
}

function buildTextWithReplacements(text, replacements) {
  if (!replacements.length) {
    return text;
  }

  let cursor = 0;
  let output = '';
  for (const replacement of replacements) {
    output += text.slice(cursor, replacement.start);
    output += replacement.to;
    cursor = replacement.end;
  }
  output += text.slice(cursor);
  return output;
}

function findBestPhraseMatch(candidate, phraseTerms) {
  if (!phraseTerms || !phraseTerms.length) {
    return null;
  }

  let best = null;
  for (const term of phraseTerms) {
    if (term.normalized === candidate) {
      return null;
    }

    const distance = levenshtein(candidate, term.normalized);
    const maxLen = Math.max(candidate.length, term.normalized.length);
    const ratio = distance / maxLen;
    const limit = maxLen <= 24 ? 3 : 4;

    if (distance > limit || ratio > 0.28) {
      continue;
    }

    if (!best || ratio < best.ratio) {
      best = {
        replacement: term.original,
        distance,
        ratio,
      };
    }
  }

  return best;
}

function applyPhraseGlossaryToText(text, glossary, correctionLimit) {
  const corrections = [];
  if (!text || !glossary.phraseWordCounts.length || correctionLimit <= 0) {
    return { text: text || '', corrections };
  }

  const tokens = collectWordTokens(text);
  if (!tokens.length) {
    return { text: text || '', corrections };
  }

  const replacements = [];
  let i = 0;

  while (i < tokens.length && corrections.length < correctionLimit) {
    let selected = null;

    for (const phraseWordCount of glossary.phraseWordCounts) {
      if (i + phraseWordCount > tokens.length) {
        continue;
      }

      const candidateTokens = tokens.slice(i, i + phraseWordCount);
      const candidate = candidateTokens.map((token) => token.normalized).join(' ');
      const termList = glossary.phraseTermsByWordCount.get(phraseWordCount);
      const best = findBestPhraseMatch(candidate, termList);

      if (!best) {
        continue;
      }

      selected = {
        from: text.slice(candidateTokens[0].start, candidateTokens[candidateTokens.length - 1].end),
        to: best.replacement,
        distance: best.distance,
        start: candidateTokens[0].start,
        end: candidateTokens[candidateTokens.length - 1].end,
        consumed: phraseWordCount,
      };
      break;
    }

    if (selected) {
      replacements.push(selected);
      corrections.push({ from: selected.from, to: selected.to, distance: selected.distance });
      i += selected.consumed;
      continue;
    }

    i += 1;
  }

  return {
    text: buildTextWithReplacements(text, replacements),
    corrections,
  };
}

export function postProcessTranscript({ text, segments = [] }) {
  if (!AUDIO_POSTPROCESS_ENABLED) {
    return {
      text: text || '',
      segments,
      corrections: [],
      enabled: false,
      glossarySize: 0,
    };
  }

  const glossary = loadGlossary();
  const correctionLimit = 60;

  const phraseResult = applyPhraseGlossaryToText(text || '', glossary, correctionLimit);
  const textWordBudget = Math.max(0, correctionLimit - phraseResult.corrections.length);
  const textWordResult = applyWordGlossaryToText(phraseResult.text, glossary.singleWordTerms, textWordBudget);
  const textResult = {
    text: textWordResult.text,
    corrections: [...phraseResult.corrections, ...textWordResult.corrections],
  };

  let remaining = Math.max(0, correctionLimit - textResult.corrections.length);

  const nextSegments = Array.isArray(segments)
    ? segments.map((segment) => {
      if (!remaining || typeof segment?.text !== 'string') {
        return segment;
      }

      const segmentPhraseResult = applyPhraseGlossaryToText(segment.text, glossary, remaining);
      let segmentRemaining = Math.max(0, remaining - segmentPhraseResult.corrections.length);
      const segmentWordResult = applyWordGlossaryToText(segmentPhraseResult.text, glossary.singleWordTerms, segmentRemaining);
      const used = segmentPhraseResult.corrections.length + segmentWordResult.corrections.length;
      remaining = Math.max(0, remaining - used);

      return {
        ...segment,
        text: segmentWordResult.text,
      };
    })
    : [];

  return {
    text: textResult.text,
    segments: nextSegments,
    corrections: textResult.corrections,
    enabled: true,
    glossarySize: glossary.size,
  };
}

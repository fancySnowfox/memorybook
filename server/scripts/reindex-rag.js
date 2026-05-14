import dotenv from 'dotenv';
import { reindexRag, getRagStatus } from '../utils/rag-llamaindex.js';

dotenv.config({ path: '.env.local' });

async function main() {
  const before = getRagStatus();
  console.log('RAG status before reindex:', before);

  const result = await reindexRag();
  console.log('RAG reindex result:', result);

  const after = getRagStatus();
  console.log('RAG status after reindex:', after);
}

main().catch((error) => {
  console.error('RAG reindex failed:', error);
  process.exit(1);
});

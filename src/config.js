const embeddingProvider = process.env.EMBEDDING_PROVIDER || 'simple';
const defaultEmbeddingDim = embeddingProvider === 'openai' ? 1536 : 256;

export const config = {
  port: Number(process.env.PORT || 3000),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  indexName: process.env.VECTOR_INDEX_NAME || 'rag_idx',
  keyPrefix: process.env.VECTOR_KEY_PREFIX || 'doc:',
  embeddingDim: Number(process.env.EMBEDDING_DIM || defaultEmbeddingDim),
  embeddingProvider,
  openAiApiKey: process.env.OPENAI_API_KEY || '',
  openAiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'
};

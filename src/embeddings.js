import { config } from './config.js';

function normalize(vector) {
  let magnitude = 0;
  for (const value of vector) {
    magnitude += value * value;
  }

  magnitude = Math.sqrt(magnitude) || 1;
  return vector.map((value) => value / magnitude);
}

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function hashToken(token) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildSimpleEmbedding(text) {
  const vector = new Array(config.embeddingDim).fill(0);
  const tokens = tokenize(text);

  if (!tokens.length) {
    return vector;
  }

  for (const token of tokens) {
    const hash = hashToken(token);
    const bucket = hash % config.embeddingDim;
    const sign = ((hash >> 1) & 1) === 0 ? 1 : -1;
    vector[bucket] += sign;
  }

  return normalize(vector);
}

async function buildOpenAiEmbedding(text) {
  if (!config.openAiApiKey) {
    throw new Error('OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openAiApiKey}`
    },
    body: JSON.stringify({
      model: config.openAiEmbeddingModel,
      input: text
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI embedding request failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const embedding = payload?.data?.[0]?.embedding;

  if (!Array.isArray(embedding) || embedding.length !== config.embeddingDim) {
    throw new Error(
      `Embedding dimension mismatch. Expected ${config.embeddingDim}, received ${embedding?.length ?? 0}`
    );
  }

  return embedding;
}

export async function getEmbedding(text) {
  if (config.embeddingProvider === 'openai') {
    return buildOpenAiEmbedding(text);
  }

  return buildSimpleEmbedding(text);
}

export function toFloat32Buffer(values) {
  return Buffer.from(Float32Array.from(values).buffer);
}

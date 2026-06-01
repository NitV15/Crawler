require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const CHUNK_SIZE = 15;
const TIMEOUT_MS = 30000;
// gemini-1.5-flash free tier: 15 RPM. 5s gap between sequential chunks = 12 RPM, safely under the limit.
const INTER_CHUNK_DELAY_MS = 5000;

function getAI() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: TIMEOUT_MS } });
}

function parseRetryDelay(err) {
  // Honour the retryDelay from 429 responses, e.g. "Please retry in 45.9s"
  try {
    const details = JSON.parse(err.message)?.error?.details || [];
    for (const d of details) {
      if (d['@type']?.includes('RetryInfo') && d.retryDelay) {
        const secs = parseFloat(d.retryDelay);
        if (secs > 0) return Math.ceil(secs) * 1000;
      }
    }
  } catch (_) {}
  // Also try parsing the message text: "retry in 45.9s"
  const m = err.message?.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  return m ? Math.ceil(parseFloat(m[1])) * 1000 : null;
}

async function callGeminiChunk(ai, chunk) {
  const pairList = chunk.map(p => ({
    index: p.originalIndex,
    candidate: { role: p.candidate.role, skills: p.candidate.skills, experience_level: p.candidate.experience_level },
    job: { title: p.job.title, company: p.job.company, location: p.job.location, snippet: (p.job.snippet || '').slice(0, 300) },
  }));

  const prompt = `You are a job relevance checker for an Indian job platform.

For each CANDIDATE + JOB pair, determine:
1. Is this job genuinely relevant to this candidate's role and skills?
2. If yes, write a 1-sentence application tip highlighting how their skills match.

Return ONLY a valid JSON array:
[
  {"index":0,"is_relevant":true,"suggested_tip":"Highlight your Kubernetes experience — the JD specifically mentions K8s cluster management."},
  {"index":1,"is_relevant":false},
  ...
]

PAIRS:
${JSON.stringify(pairList)}`;

  const result = await ai.models.generateContent({ model: 'gemini-1.5-flash', contents: prompt });
  const text = result.text.trim().replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(text);
}

async function callWithRetry(ai, chunk, attempt = 0) {
  try {
    const results = await callGeminiChunk(ai, chunk);
    return Array.isArray(results) ? results : [];
  } catch (err) {
    if (attempt < 2) {
      // Use the server-provided retry delay for rate-limit errors, else exponential backoff
      const retryDelay = parseRetryDelay(err) || (attempt + 1) * 10000;
      console.error(`[job-matcher] Chunk failed (attempt ${attempt + 1}), retrying in ${Math.round(retryDelay / 1000)}s: ${err.message.slice(0, 120)}`);
      await new Promise(r => setTimeout(r, retryDelay));
      return callWithRetry(ai, chunk, attempt + 1);
    }
    console.error(`[job-matcher] Chunk failed after ${attempt + 1} attempts: ${err.message.slice(0, 120)}`);
    return [];
  }
}

async function processJobBatch(pairs) {
  if (!pairs.length) return [];

  const ai = getAI();

  // Tag each pair with its original index before chunking
  const tagged = pairs.map((p, i) => ({ ...p, originalIndex: i }));

  // Split into chunks of CHUNK_SIZE
  const chunks = [];
  for (let i = 0; i < tagged.length; i += CHUNK_SIZE) {
    chunks.push(tagged.slice(i, i + CHUNK_SIZE));
  }

  // Process sequentially — free tier is 5 RPM, concurrent calls exhaust it instantly.
  // 13s between chunks keeps us safely under the rate limit.
  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, INTER_CHUNK_DELAY_MS));
    const chunkResults = await callWithRetry(ai, chunks[i]);
    results.push(...chunkResults);
  }

  return results;
}

module.exports = { processJobBatch };

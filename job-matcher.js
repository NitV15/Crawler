require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const CHUNK_SIZE = 15;
const CONCURRENCY = 3;
const TIMEOUT_MS = 30000;

function getAI() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: TIMEOUT_MS } });
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

  const result = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
  const text = result.text.trim().replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(text);
}

async function callWithRetry(ai, chunk, attempt = 0) {
  try {
    const results = await callGeminiChunk(ai, chunk);
    return Array.isArray(results) ? results : [];
  } catch (err) {
    if (attempt < 2) {
      const delay = (attempt + 1) * 5000;
      console.error(`[job-matcher] Chunk failed (attempt ${attempt + 1}), retrying in ${delay / 1000}s: ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
      return callWithRetry(ai, chunk, attempt + 1);
    }
    console.error(`[job-matcher] Chunk failed after ${attempt + 1} attempts: ${err.message}`);
    return [];
  }
}

async function processJobBatch(pairs) {
  if (!pairs.length) return [];

  const ai = getAI();

  // Tag each pair with its original index before chunking
  const tagged = pairs.map((p, i) => ({ ...p, originalIndex: i }));

  // Split into chunks
  const chunks = [];
  for (let i = 0; i < tagged.length; i += CHUNK_SIZE) {
    chunks.push(tagged.slice(i, i + CHUNK_SIZE));
  }

  // Process with limited concurrency
  const results = [];
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(chunk => callWithRetry(ai, chunk)));
    results.push(...batchResults.flat());
  }

  return results;
}

module.exports = { processJobBatch };

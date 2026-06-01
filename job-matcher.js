require('dotenv').config();
const Groq = require('groq-sdk');

const CHUNK_SIZE = 15;
// llama-3.1-8b-instant free tier: 14,400 RPD, 30 RPM.
// Sequential chunks with 3s gap = 20 RPM, safely under the limit.
const INTER_CHUNK_DELAY_MS = 3000;

function getClient() {
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

async function callGroqChunk(client, chunk) {
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

  const completion = await client.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
  });

  const raw = completion.choices[0].message.content;
  // Extract the JSON array even if the model appends explanatory text after it
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`No JSON array in response: ${raw.slice(0, 200)}`);
  return JSON.parse(match[0]);
}

async function callWithRetry(client, chunk, attempt = 0) {
  try {
    const results = await callGroqChunk(client, chunk);
    return Array.isArray(results) ? results : [];
  } catch (err) {
    if (attempt < 2) {
      const delay = (attempt + 1) * 10000;
      console.error(`[job-matcher] Chunk failed (attempt ${attempt + 1}), retrying in ${delay / 1000}s: ${String(err.message).slice(0, 120)}`);
      await new Promise(r => setTimeout(r, delay));
      return callWithRetry(client, chunk, attempt + 1);
    }
    console.error(`[job-matcher] Chunk failed after ${attempt + 1} attempts: ${String(err.message).slice(0, 120)}`);
    return [];
  }
}

async function processJobBatch(pairs) {
  if (!pairs.length) return [];

  const client = getClient();
  const tagged = pairs.map((p, i) => ({ ...p, originalIndex: i }));

  const chunks = [];
  for (let i = 0; i < tagged.length; i += CHUNK_SIZE) {
    chunks.push(tagged.slice(i, i + CHUNK_SIZE));
  }

  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, INTER_CHUNK_DELAY_MS));
    const chunkResults = await callWithRetry(client, chunks[i]);
    results.push(...chunkResults);
  }

  return results;
}

module.exports = { processJobBatch };

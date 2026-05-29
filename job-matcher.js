require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

function getAI() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

async function processJobBatch(pairs) {
  if (!pairs.length) return [];

  const ai = getAI();

  const pairList = pairs.map((p, i) => ({
    index: i,
    candidate: {
      role: p.candidate.role,
      skills: p.candidate.skills,
      experience_level: p.candidate.experience_level,
    },
    job: {
      title: p.job.title,
      company: p.job.company,
      location: p.job.location,
      snippet: (p.job.snippet || '').slice(0, 300),
    },
  }));

  const prompt = `You are a job relevance checker for an Indian job platform.

For each CANDIDATE + JOB pair, determine:
1. Is this job genuinely relevant to this candidate's role and skills?
2. If yes, write a 1-sentence application tip highlighting how their skills match.

Return ONLY a valid JSON array in the same order:
[
  {"index":0,"is_relevant":true,"suggested_tip":"Highlight your Kubernetes experience — the JD specifically mentions K8s cluster management."},
  {"index":1,"is_relevant":false},
  ...
]

PAIRS:
${JSON.stringify(pairList)}`;

  async function callGemini() {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini timeout after 30s')), 30000)
    );
    const result = await Promise.race([
      ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt }),
      timeoutPromise,
    ]);
    const text = result.text.trim().replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
    return JSON.parse(text);
  }

  try {
    const parsed = await callGemini();
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[job-matcher] Batch failed, retrying in 5s:', err.message);
    await new Promise(r => setTimeout(r, 5000));
    try {
      const parsed = await callGemini();
      return Array.isArray(parsed) ? parsed : [];
    } catch (retryErr) {
      console.error('[job-matcher] Batch failed after retry:', retryErr.message);
      return [];
    }
  }
}

module.exports = { processJobBatch };

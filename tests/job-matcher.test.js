jest.mock('@google/genai');
const { GoogleGenAI } = require('@google/genai');
const { processJobBatch } = require('../job-matcher');

const fakePairs = [
  {
    candidate: { role: 'DevOps Engineer', skills: 'Docker, Kubernetes', experience_level: '3-5 yr' },
    job: { title: 'Senior DevOps Engineer', company: 'Razorpay', location: 'Bangalore', snippet: 'K8s cluster management required.' },
  },
  {
    candidate: { role: 'WordPress Developer', skills: 'PHP, WooCommerce', experience_level: '1-3 yr' },
    job: { title: 'Java Developer', company: 'Infosys', location: 'Pune', snippet: 'Spring Boot and Hibernate.' },
  },
];

function mockGemini(text) {
  GoogleGenAI.mockImplementation(() => ({
    models: { generateContent: jest.fn().mockResolvedValue({ text }) },
  }));
}

beforeEach(() => { jest.clearAllMocks(); process.env.GEMINI_API_KEY = 'test'; });

test('returns empty array for empty input without calling Gemini', async () => {
  const result = await processJobBatch([]);
  expect(result).toEqual([]);
  expect(GoogleGenAI).not.toHaveBeenCalled();
});

test('returns parsed results for valid batch', async () => {
  mockGemini(JSON.stringify([
    { index: 0, is_relevant: true, suggested_tip: 'Highlight K8s cluster management.' },
    { index: 1, is_relevant: false },
  ]));
  const result = await processJobBatch(fakePairs);
  expect(result.length).toBe(2);
  expect(result[0].is_relevant).toBe(true);
  expect(result[0].suggested_tip).toBe('Highlight K8s cluster management.');
  expect(result[1].is_relevant).toBe(false);
});

test('strips markdown code fences before parsing', async () => {
  mockGemini('```json\n[{"index":0,"is_relevant":true,"suggested_tip":"Great match!"}]\n```');
  const result = await processJobBatch([fakePairs[0]]);
  expect(result[0].is_relevant).toBe(true);
});

test('retries once on parse failure then returns empty array', async () => {
  jest.useFakeTimers();
  GoogleGenAI.mockImplementation(() => ({
    models: { generateContent: jest.fn().mockResolvedValue({ text: 'not json' }) },
  }));
  const promise = processJobBatch(fakePairs);
  await jest.runAllTimersAsync();
  const result = await promise;
  jest.useRealTimers();
  expect(result).toEqual([]);
  const genAI = GoogleGenAI.mock.results[0].value;
  expect(genAI.models.generateContent).toHaveBeenCalledTimes(2);
});

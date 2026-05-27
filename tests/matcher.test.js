jest.mock('@google/genai');
const { GoogleGenAI } = require('@google/genai');
const { processPostBatch, identifyLead } = require('../matcher');

function mockGeminiResponse(json) {
  GoogleGenAI.mockImplementation(() => ({
    models: {
      generateContent: jest.fn().mockResolvedValue({ text: JSON.stringify(json) }),
    },
  }));
}

beforeEach(() => jest.clearAllMocks());

test('returns empty array for empty posts input', async () => {
  const results = await processPostBatch([], []);
  expect(results).toEqual([]);
});

test('returns array with one result for one post', async () => {
  mockGeminiResponse([{ post_id: 'reddit_abc', is_lead: false, is_hiring_post: false }]);
  const posts = [{ post_id: 'reddit_abc', title: 'Test', text: '', subreddit: 'india', source: 'reddit' }];
  const results = await processPostBatch(posts, []);
  expect(results).toHaveLength(1);
  expect(results[0].is_lead).toBe(false);
});

test('returns full lead result with matched_dealer_ids', async () => {
  mockGeminiResponse([{
    post_id: 'reddit_def',
    is_lead: true,
    is_hiring_post: false,
    lead_category: 'Furniture & Home Decor',
    what_to_sell: 'wardrobe',
    post_location: 'Faridabad',
    suggested_reply: 'We can help!',
    matched_dealer_ids: [3, 7],
  }]);
  const posts = [{ post_id: 'reddit_def', title: 'Need wardrobe', text: '', subreddit: 'Faridabad', source: 'reddit' }];
  const results = await processPostBatch(posts, [{ id: 3 }, { id: 7 }]);
  expect(results[0].is_lead).toBe(true);
  expect(results[0].matched_dealer_ids).toEqual([3, 7]);
  expect(results[0].lead_category).toBe('Furniture & Home Decor');
});

test('retries once on JSON parse failure and returns result on retry', async () => {
  let callCount = 0;
  GoogleGenAI.mockImplementation(() => ({
    models: {
      generateContent: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ text: 'invalid json {{' });
        return Promise.resolve({ text: JSON.stringify([{ post_id: 'p1', is_lead: false, is_hiring_post: false }]) });
      }),
    },
  }));
  const posts = [{ post_id: 'p1', title: 'test', text: '', subreddit: 'india', source: 'reddit' }];
  const results = await processPostBatch(posts, []);
  expect(callCount).toBe(2);
  expect(results[0].is_lead).toBe(false);
});

test('returns empty array after two consecutive JSON parse failures', async () => {
  GoogleGenAI.mockImplementation(() => ({
    models: { generateContent: jest.fn().mockResolvedValue({ text: 'not valid json' }) },
  }));
  const posts = [{ post_id: 'p1', title: 'test', text: '', subreddit: 'india', source: 'reddit' }];
  const results = await processPostBatch(posts, []);
  expect(results).toEqual([]);
});

test('strips markdown code fences from Gemini response', async () => {
  GoogleGenAI.mockImplementation(() => ({
    models: {
      generateContent: jest.fn().mockResolvedValue({
        text: '```json\n[{"post_id":"p1","is_lead":false,"is_hiring_post":false}]\n```',
      }),
    },
  }));
  const posts = [{ post_id: 'p1', title: 'test', text: '', subreddit: 'india', source: 'reddit' }];
  const results = await processPostBatch(posts, []);
  expect(results[0].is_lead).toBe(false);
});

test('identifyLead wraps processPostBatch and returns single result', async () => {
  mockGeminiResponse([{ post_id: 'single', is_lead: false, is_hiring_post: false }]);
  const result = await identifyLead({ postTitle: 'test', postText: '', subreddit: 'india' });
  expect(result.is_lead).toBe(false);
  expect(result.is_hiring_post).toBe(false);
});

test('identifyLead returns fallback on empty batch result', async () => {
  mockGeminiResponse([]);
  const result = await identifyLead({ postTitle: 'test', postText: '', subreddit: 'india' });
  expect(result.is_lead).toBe(false);
  expect(result.is_hiring_post).toBe(false);
});

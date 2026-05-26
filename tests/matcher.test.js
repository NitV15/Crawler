jest.mock('@google/genai');
const { GoogleGenAI } = require('@google/genai');
const { identifyLead } = require('../matcher');

function mockGeminiResponse(json) {
  GoogleGenAI.mockImplementation(() => ({
    models: {
      generateContent: jest.fn().mockResolvedValue({ text: JSON.stringify(json) })
    }
  }));
}

beforeEach(() => jest.clearAllMocks());

test('returns is_lead false for non-lead post', async () => {
  mockGeminiResponse({ is_lead: false, is_hiring_post: false });
  const result = await identifyLead({ postTitle: 'News today', postText: '', subreddit: 'india' });
  expect(result.is_lead).toBe(false);
});

test('returns is_hiring_post true for recruitment post', async () => {
  mockGeminiResponse({ is_lead: false, is_hiring_post: true });
  const result = await identifyLead({ postTitle: 'Hiring developers', postText: '', subreddit: 'india' });
  expect(result.is_hiring_post).toBe(true);
});

test('returns full lead object for genuine lead', async () => {
  mockGeminiResponse({
    is_lead: true,
    is_hiring_post: false,
    lead_category: 'Furniture & Home Decor',
    what_to_sell: 'modular wardrobe',
    suggested_reply: 'We offer great wardrobes!',
    post_location: 'Faridabad'
  });
  const result = await identifyLead({ postTitle: 'Need wardrobe', postText: 'sector 15 faridabad', subreddit: 'Faridabad' });
  expect(result.is_lead).toBe(true);
  expect(result.lead_category).toBe('Furniture & Home Decor');
  expect(result.post_location).toBe('Faridabad');
});

test('strips markdown code fences from Gemini response', async () => {
  GoogleGenAI.mockImplementation(() => ({
    models: {
      generateContent: jest.fn().mockResolvedValue({
        text: '```json\n{"is_lead":false,"is_hiring_post":false}\n```'
      })
    }
  }));
  const result = await identifyLead({ postTitle: 'test', postText: '', subreddit: 'india' });
  expect(result.is_lead).toBe(false);
});

test('uses INSTAGRAM POST header when source is instagram', async () => {
  let capturedPrompt = '';
  GoogleGenAI.mockImplementation(() => ({
    models: {
      generateContent: jest.fn().mockImplementation(({ contents }) => {
        capturedPrompt = contents;
        return Promise.resolve({ text: JSON.stringify({ is_lead: false, is_hiring_post: false }) });
      }),
    },
  }));
  await identifyLead({ postTitle: '', postText: 'Just moved to Pune!', subreddit: 'instagram', source: 'instagram' });
  expect(capturedPrompt).toContain('INSTAGRAM POST');
  expect(capturedPrompt).toContain('INDIRECT buyer intent');
  expect(capturedPrompt).not.toContain('REDDIT POST');
});

test('uses INDIAMART LISTING header when source is indiamart', async () => {
  let capturedPrompt = '';
  GoogleGenAI.mockImplementation(() => ({
    models: {
      generateContent: jest.fn().mockImplementation(({ contents }) => {
        capturedPrompt = contents;
        return Promise.resolve({ text: JSON.stringify({ is_lead: false, is_hiring_post: false }) });
      }),
    },
  }));
  await identifyLead({ postTitle: 'Need furniture', postText: 'description', subreddit: 'indiamart', source: 'indiamart' });
  expect(capturedPrompt).toContain('INDIAMART LISTING');
  expect(capturedPrompt).not.toContain('REDDIT POST');
});

test('defaults to REDDIT POST header when source is omitted', async () => {
  let capturedPrompt = '';
  GoogleGenAI.mockImplementation(() => ({
    models: {
      generateContent: jest.fn().mockImplementation(({ contents }) => {
        capturedPrompt = contents;
        return Promise.resolve({ text: JSON.stringify({ is_lead: false, is_hiring_post: false }) });
      }),
    },
  }));
  await identifyLead({ postTitle: 'Need wardrobe', postText: '', subreddit: 'india' });
  expect(capturedPrompt).toContain('REDDIT POST');
});

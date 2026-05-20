jest.mock('@google/genai');
const { GoogleGenAI } = require('@google/genai');
const { matchPost } = require('../matcher');

const dealers = [
  { id: 1, name: 'Travel Co', industry: 'Travel', description: 'We offer travel packages and tours' },
  { id: 2, name: 'Gym World', industry: 'Gym Equipment', description: 'We sell treadmills, dumbbells, gym mats' },
];

function mockGemini(responseText) {
  GoogleGenAI.mockImplementation(() => ({
    models: { generateContent: jest.fn().mockResolvedValue({ text: responseText }) },
  }));
}

describe('matchPost', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns null immediately when dealers list is empty', async () => {
    const result = await matchPost({ postTitle: 'test', postText: 'test', subreddit: 'test' }, []);
    expect(result).toBeNull();
    expect(GoogleGenAI).not.toHaveBeenCalled();
  });

  test('returns matched result with dealer_id, reason, suggested_reply', async () => {
    mockGemini('{"matched": true, "dealer_id": 1, "reason": "User loves travelling", "suggested_reply": "We can plan your trip!"}');

    const result = await matchPost(
      { postTitle: 'I love travelling!', postText: 'Planning a big trip', subreddit: 'india' },
      dealers
    );

    expect(result.matched).toBe(true);
    expect(result.dealer_id).toBe(1);
    expect(result.reason).toBe('User loves travelling');
    expect(result.suggested_reply).toBe('We can plan your trip!');
  });

  test('returns not matched when AI says no', async () => {
    mockGemini('{"matched": false}');

    const result = await matchPost(
      { postTitle: 'What is the weather today?', postText: '', subreddit: 'AskReddit' },
      dealers
    );

    expect(result.matched).toBe(false);
  });

  test('handles Gemini response wrapped in markdown code block', async () => {
    mockGemini('```json\n{"matched": true, "dealer_id": 2, "reason": "Wants gym gear", "suggested_reply": "Check us out!"}\n```');

    const result = await matchPost(
      { postTitle: 'Opening a gym', postText: 'Need equipment', subreddit: 'entrepreneur' },
      dealers
    );

    expect(result.matched).toBe(true);
    expect(result.dealer_id).toBe(2);
  });
});

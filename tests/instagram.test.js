const { buildDealerHashtags } = require('../instagram-fetcher');

describe('buildDealerHashtags', () => {
  test('returns empty array for no dealers', () => {
    expect(buildDealerHashtags([])).toEqual([]);
  });

  test('extracts hashtags from industry_category', () => {
    const tags = buildDealerHashtags([{ industry_category: 'Travel & Tourism', keywords: '' }]);
    expect(tags).toContain('travel');
    expect(tags).toContain('tourism');
    expect(tags).not.toContain('&');
  });

  test('extracts hashtags from keywords', () => {
    const tags = buildDealerHashtags([{ industry_category: '', keywords: 'car insurance, vehicle' }]);
    expect(tags).toContain('car');
    expect(tags).toContain('insurance');
    expect(tags).toContain('vehicle');
  });

  test('deduplicates across dealers', () => {
    const dealers = [
      { industry_category: 'Travel', keywords: '' },
      { industry_category: 'Travel', keywords: '' },
    ];
    expect(buildDealerHashtags(dealers).filter(t => t === 'travel').length).toBe(1);
  });

  test('excludes words shorter than 3 chars and stop words', () => {
    const tags = buildDealerHashtags([{ industry_category: 'IT Services & Software', keywords: '' }]);
    expect(tags).not.toContain('it');
    expect(tags).not.toContain('&');
    expect(tags).toContain('services');
    expect(tags).toContain('software');
  });

  test('combines industry_category and keywords from multiple dealers', () => {
    const dealers = [
      { industry_category: 'Automotive', keywords: '' },
      { industry_category: 'Real Estate', keywords: 'flat, villa' },
    ];
    const tags = buildDealerHashtags(dealers);
    expect(tags).toContain('automotive');
    expect(tags).toContain('real');
    expect(tags).toContain('flat');
    expect(tags).toContain('villa');
  });
});

jest.mock('child_process', () => ({ spawn: jest.fn() }));
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

function makeChild(stdoutLines = [], exitCode = 0) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  spawn.mockReturnValueOnce(child);
  setImmediate(() => {
    stdoutLines.forEach(l => child.stdout.emit('data', l + '\n'));
    child.emit('close', exitCode);
  });
}

describe('fetchInstagramLeads', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns empty array when script exits with error code', async () => {
    makeChild([], 1);
    const { fetchInstagramLeads } = require('../instagram-fetcher');
    const result = await fetchInstagramLeads([]);
    expect(result).toEqual([]);
  });

  test('returns empty array on spawn error', async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    spawn.mockReturnValueOnce(child);
    // Don't emit error in setImmediate - the function should handle it
    const { fetchInstagramLeads } = require('../instagram-fetcher');
    const promise = fetchInstagramLeads([]);
    // Now emit the error
    setImmediate(() => child.emit('error', new Error('python3 not found')));
    const result = await promise;
    expect(result).toEqual([]);
  });

  test('parses valid JSON lines and returns normalized posts', async () => {
    const post = {
      id: 'ig_123', title: '', selftext: 'Just moved to Bangalore!',
      permalink: 'https://www.instagram.com/p/abc/', _subreddit: 'instagram',
    };
    makeChild([JSON.stringify(post)]);
    const { fetchInstagramLeads } = require('../instagram-fetcher');
    const result = await fetchInstagramLeads([]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(post);
  });

  test('skips malformed JSON lines', async () => {
    const post = {
      id: 'ig_456', title: '', selftext: 'Planning a trip!',
      permalink: 'https://www.instagram.com/p/xyz/', _subreddit: 'instagram',
    };
    makeChild(['not-json', JSON.stringify(post), '{broken']);
    const { fetchInstagramLeads } = require('../instagram-fetcher');
    const result = await fetchInstagramLeads([]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ig_456');
  });

  test('skips posts without _subreddit instagram', async () => {
    const badPost = { id: 'xx_1', title: 'test', selftext: 'text', permalink: 'http://x', _subreddit: 'reddit' };
    const goodPost = { id: 'ig_2', title: '', selftext: 'text', permalink: 'http://y', _subreddit: 'instagram' };
    makeChild([JSON.stringify(badPost), JSON.stringify(goodPost)]);
    const { fetchInstagramLeads } = require('../instagram-fetcher');
    const result = await fetchInstagramLeads([]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ig_2');
  });

  test('passes --keywords and --hashtags and --max args to python', async () => {
    makeChild([]);
    const { fetchInstagramLeads } = require('../instagram-fetcher');
    await fetchInstagramLeads([{ industry_category: 'Travel', keywords: '' }]);
    expect(spawn).toHaveBeenCalledWith('python3', expect.arrayContaining([
      '--keywords', expect.any(String),
      '--hashtags', expect.stringContaining('travel'),
      '--max', '80',
    ]));
  });
});

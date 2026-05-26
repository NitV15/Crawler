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

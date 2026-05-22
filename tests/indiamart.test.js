const { buildQueries } = require('../indiamart-fetcher');

describe('buildQueries', () => {
  test('returns empty array when no dealers', () => {
    expect(buildQueries([])).toEqual([]);
  });

  test('skips dealers with no city', () => {
    expect(buildQueries([{ industry_category: 'Furniture', city: '' }])).toEqual([]);
  });

  test('builds category+city query', () => {
    const queries = buildQueries([{
      industry_category: 'Furniture & Home Decor',
      city: 'Faridabad',
      keywords: '',
    }]);
    expect(queries).toContain('Furniture Faridabad');
  });

  test('strips second part of category after &', () => {
    const queries = buildQueries([{
      industry_category: 'Healthcare & Wellness',
      city: 'Delhi',
      keywords: '',
    }]);
    expect(queries).toContain('Healthcare Delhi');
    expect(queries.some(q => q.includes('&'))).toBe(false);
  });

  test('adds keyword queries for top 2 keywords', () => {
    const queries = buildQueries([{
      industry_category: 'Furniture & Home Decor',
      city: 'Noida',
      keywords: 'sofa, chair, table',
    }]);
    expect(queries).toContain('sofa Noida');
    expect(queries).toContain('chair Noida');
    expect(queries).not.toContain('table Noida');
  });

  test('deduplicates identical queries across dealers', () => {
    const dealers = [
      { industry_category: 'Furniture', city: 'Faridabad', keywords: '' },
      { industry_category: 'Furniture', city: 'Faridabad', keywords: '' },
    ];
    const queries = buildQueries(dealers);
    expect(queries.filter(q => q === 'Furniture Faridabad').length).toBe(1);
  });

  test('handles multiple dealers with different cities', () => {
    const dealers = [
      { industry_category: 'Automotive', city: 'Delhi', keywords: '' },
      { industry_category: 'Automotive', city: 'Gurugram', keywords: '' },
    ];
    const queries = buildQueries(dealers);
    expect(queries).toContain('Automotive Delhi');
    expect(queries).toContain('Automotive Gurugram');
    expect(queries.length).toBe(2);
  });
});

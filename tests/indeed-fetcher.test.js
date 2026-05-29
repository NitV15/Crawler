const { fetchIndeedJobs } = require('../indeed-fetcher');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ADZUNA_APP_ID = 'testid';
  process.env.ADZUNA_APP_KEY = 'testkey';
});

test('fetchIndeedJobs throws if ADZUNA credentials not set', async () => {
  delete process.env.ADZUNA_APP_ID;
  delete process.env.ADZUNA_APP_KEY;
  await expect(fetchIndeedJobs('DevOps', '', 'Bangalore')).rejects.toThrow('ADZUNA_APP_ID and ADZUNA_APP_KEY must be set');
});

test('fetchIndeedJobs calls correct Adzuna URL and maps results', async () => {
  const mockResult = {
    results: [
      {
        id: 'abc123',
        title: 'DevOps Engineer',
        company: { display_name: 'Razorpay' },
        location: { display_name: 'Bangalore, Karnataka' },
        redirect_url: 'https://www.adzuna.com/jobs/details/abc123',
        description: 'We need a DevOps engineer with Docker experience.',
        created: '2026-05-26T10:00:00Z',
      },
    ],
  };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResult) });

  const jobs = await fetchIndeedJobs('DevOps Engineer', '', 'Bangalore');

  expect(global.fetch).toHaveBeenCalledTimes(1);
  const calledUrl = global.fetch.mock.calls[0][0];
  expect(calledUrl).toContain('api.adzuna.com');
  expect(calledUrl).toContain('DevOps');
  expect(calledUrl).toContain('Bangalore');

  expect(jobs.length).toBe(1);
  expect(jobs[0].job_id).toBe('adzuna_abc123');
  expect(jobs[0].title).toBe('DevOps Engineer');
  expect(jobs[0].company).toBe('Razorpay');
  expect(jobs[0].url).toBe('https://www.adzuna.com/jobs/details/abc123');
});

test('fetchIndeedJobs returns empty array when results missing', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  const jobs = await fetchIndeedJobs('WordPress Developer', '', 'Delhi');
  expect(jobs).toEqual([]);
});

test('fetchIndeedJobs throws on non-200 response', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
  await expect(fetchIndeedJobs('DevOps', '', 'Bangalore')).rejects.toThrow('Adzuna API HTTP 403');
});

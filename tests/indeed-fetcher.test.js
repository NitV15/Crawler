const { fetchIndeedJobs } = require('../indeed-fetcher');

beforeEach(() => { jest.clearAllMocks(); });

test('fetchIndeedJobs throws if INDEED_PUBLISHER_ID not set', async () => {
  delete process.env.INDEED_PUBLISHER_ID;
  await expect(fetchIndeedJobs('DevOps', 'Docker', 'Bangalore')).rejects.toThrow('INDEED_PUBLISHER_ID not set');
});

test('fetchIndeedJobs calls correct URL and maps results', async () => {
  process.env.INDEED_PUBLISHER_ID = 'testpub';
  const mockResult = {
    results: [
      {
        jobkey: 'abc123',
        jobtitle: 'DevOps Engineer',
        company: 'Razorpay',
        formattedLocation: 'Bangalore, Karnataka',
        url: 'https://www.indeed.com/viewjob?jk=abc123',
        snippet: 'We need a DevOps engineer with Docker experience.',
        date: 'Mon, 26 May 2026 10:00:00 GMT',
      },
    ],
  };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResult) });

  const jobs = await fetchIndeedJobs('DevOps Engineer', 'Docker, Kubernetes', 'Bangalore');

  expect(global.fetch).toHaveBeenCalledTimes(1);
  const calledUrl = global.fetch.mock.calls[0][0];
  expect(calledUrl).toContain('api.indeed.com');
  expect(calledUrl).toContain('DevOps+Engineer');
  expect(calledUrl).toContain('Bangalore');
  expect(calledUrl).toContain('co=in');

  expect(jobs.length).toBe(1);
  expect(jobs[0].job_id).toBe('indeed_abc123');
  expect(jobs[0].title).toBe('DevOps Engineer');
  expect(jobs[0].company).toBe('Razorpay');
  expect(jobs[0].url).toBe('https://www.indeed.com/viewjob?jk=abc123');
});

test('fetchIndeedJobs returns empty array when results missing', async () => {
  process.env.INDEED_PUBLISHER_ID = 'testpub';
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  const jobs = await fetchIndeedJobs('WordPress Developer', 'PHP', 'Delhi');
  expect(jobs).toEqual([]);
});

test('fetchIndeedJobs throws on non-200 response', async () => {
  process.env.INDEED_PUBLISHER_ID = 'testpub';
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
  await expect(fetchIndeedJobs('DevOps', 'Docker', 'Bangalore')).rejects.toThrow('Indeed API HTTP 403');
});
